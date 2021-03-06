import {
    Class,
    Configuration,
    createRoute,
    errorMessage,
    IgnoreDecorator,
    Invocation,
    isCustomClass,
    resolvePath,
    RootDecorator,
    RouteDecorator,
    RouteInfo,
} from "@plumier/core"
import chalk from "chalk"
import { Context } from "koa"
import Ptr from "path-to-regexp"
import { ClassReflection, MethodReflection, ParameterReflection, PropertyReflection, reflect } from "tinspector"

import { bindParameter } from "./binder"


//import * as Path from "path";
/* ------------------------------------------------------------------------------- */
/* ---------------------------------- TYPES -------------------------------------- */
/* ------------------------------------------------------------------------------- */

type AnalyzerFunction = (route: RouteInfo, allRoutes: RouteInfo[]) => Issue
type PropOrParamReflection = PropertyReflection | ParameterReflection
interface Issue { type: "error" | "warning" | "success", message?: string }
interface TestResult { route: RouteInfo, issues: Issue[] }
export interface TransformOption { root?: string }

/* ------------------------------------------------------------------------------- */
/* ------------------------------- HELPERS --------------------------------------- */
/* ------------------------------------------------------------------------------- */

export function striveController(name: string) {
    return name.substring(0, name.lastIndexOf("Controller")).toLowerCase()
}

export function getControllerRoute(controller: ClassReflection) {
    const root: RootDecorator = controller.decorators.find((x: RootDecorator) => x.name == "Root")
    return (root && root.url) || `/${striveController(controller.name)}`
}

function getActionName(route: RouteInfo) {
    return `${route.controller.name}.${route.action.name}(${route.action.parameters.map(x => x.name).join(", ")})`
}

function getRoot(rootPath: string, path: string) {
    const part = path.slice(rootPath.length).split("/").filter(x => !!x)
        .slice(0, -1)
    return (part.length === 0) ? undefined : createRoute(...part)
}

/* ------------------------------------------------------------------------------- */
/* ---------------------------------- TRANSFORMER -------------------------------- */
/* ------------------------------------------------------------------------------- */

function transformDecorator(rootRoute: string, controllerRoute: string, actionName: string, actionDecorator: RouteDecorator) {
    //absolute route
    if (actionDecorator.url && actionDecorator.url.startsWith("/"))
        return createRoute(rootRoute, actionDecorator.url)
    //empty string
    else if (actionDecorator.url === "")
        return createRoute(rootRoute, controllerRoute)
    //relative route
    else {
        const actionUrl = actionDecorator.url || actionName.toLowerCase()
        return createRoute(rootRoute, controllerRoute, actionUrl)
    }
}

function transformControllerWithDecorator(controller: ClassReflection, method: MethodReflection, opt?: TransformOption): RouteInfo[] {
    if (method.decorators.some((x: IgnoreDecorator) => x.name == "Ignore")) return []
    const ctlRoute = getControllerRoute(controller)
    const result = <RouteInfo>{ action: method, controller: controller }
    const rootRoute = opt && opt.root || ""
    return method.decorators.reverse().filter((x: RouteDecorator): x is RouteDecorator => x.name == "Route")
        .map(x => ({
            ...result,
            method: x.method,
            url: transformDecorator(rootRoute, ctlRoute, method.name, x)
        }))
}

function transformRegularController(controller: ClassReflection, method: MethodReflection, opt?: TransformOption): RouteInfo[] {
    return [{
        method: "get",
        url: createRoute(opt && opt.root || "", getControllerRoute(controller), method.name),
        action: method,
        controller: controller,
    }]
}

export function transformController(object: ClassReflection | Class, opt?: TransformOption) {
    const controller = typeof object === "function" ? reflect(object) : object
    if (!controller.name.toLowerCase().endsWith("controller")) return []
    return controller.methods.map(method => {
        //first priority is decorator
        if (method.decorators.some((x: IgnoreDecorator | RouteDecorator) => x.name == "Ignore" || x.name == "Route"))
            return transformControllerWithDecorator(controller, method, opt)
        else
            return transformRegularController(controller, method, opt)
    }).flatten()
}

export function transformModule(path: string): RouteInfo[] {
    //read all files and get module reflection
    return resolvePath(path)
        //reflect the file
        .map(x => ({
            root: getRoot(path, x),
            meta: reflect(x).members.filter((x): x is ClassReflection => x.kind === "Class"
                && x.name.toLowerCase().endsWith("controller"))
        }))
        .map(
            x => x.meta
                .map(meta => transformController(meta, { root: x.root }))
                .flatten()
        )
        .flatten()
}

/* ------------------------------------------------------------------------------- */
/* ------------------------------- ROUTER ---------------------------------------- */
/* ------------------------------------------------------------------------------- */

function toRegExp(route: RouteInfo, path: string): RouteMatcher {
    const keys: Ptr.Key[] = []
    const regexp = Ptr(route.url, keys)
    const match = regexp.exec(path)
    const query = !match ? {} : keys.reduce((a, b, i) => {
        a[b.name] = match![i + 1]
        return a;
    }, <any>{})
    return { match, query, method: route.method.toUpperCase(), route }
}

interface RouteMatcher {
    match: RegExpExecArray | null,
    query: any,
    method: string,
    route: RouteInfo
}

export function router(infos: RouteInfo[], config: Configuration, handler: (ctx: Context) => Invocation) {
    const matchers: { [key: string]: RouteMatcher | undefined } = {}
    const getMatcher = (path: string, method: string) => infos.map(x => toRegExp(x, path)).find(x => Boolean(x.match) && x.method == method)
    return async (ctx: Context, next: () => Promise<void>) => {
        const key = `${ctx.method}${ctx.path}`
        const match = matchers[key] || (matchers[key] = getMatcher(ctx.path, ctx.method))
        ctx.config = config;
        if (match) {
            Object.assign(ctx.request.query, match.query)
            const parameters = bindParameter(ctx, match.route.action, config.converters)
            ctx.route = match.route;
            ctx.parameters = parameters
        }
        const invocation = handler(ctx)
        const result = await invocation.proceed()
        await result.execute(ctx)
    }
}

/* ------------------------------------------------------------------------------- */
/* --------------------------- ANALYZER FUNCTION --------------------------------- */
/* ------------------------------------------------------------------------------- */

//------ Analyzer Helpers
function getModelsInParameters(par: PropOrParamReflection[]) {
    return par
        .map((x, i) => ({ type: x.type, index: i }))
        .filter(x => x.type && isCustomClass(x.type))
        .map(x => ({ meta: reflect((Array.isArray(x.type) ? x.type[0] : x.type) as Class), index: x.index }))
}

function traverseModel(par: PropOrParamReflection[]): ClassReflection[] {
    const models = getModelsInParameters(par).map(x => x.meta)
    const child = models.map(x => traverseModel(x.properties))
        .filter((x): x is ClassReflection[] => Boolean(x))
        .reduce((a, b) => a!.concat(b!), [] as ClassReflection[])
    return models.concat(child)
}

function traverseArray(parent: string, par: PropOrParamReflection[]): string[] {
    const models = getModelsInParameters(par)
    if (models.length > 0) {
        return models.map((x, i) => traverseArray(x.meta.name, x.meta.properties))
            .flatten()
    }
    return par.filter(x => x.type === Array)
        .map(x => `${parent}.${x.name}`)
}

//----- 

function backingParameterTest(route: RouteInfo, allRoutes: RouteInfo[]): Issue {
    const ids = route.url.split("/")
        .filter(x => x.startsWith(":"))
        .map(x => x.substring(1).toLowerCase())
    const missing = ids.filter(id => route.action.parameters.map(x => x.name.toLowerCase()).indexOf(id) === -1)
    if (missing.length > 0) {
        return {
            type: "error",
            message: errorMessage.RouteDoesNotHaveBackingParam.format(missing.join(", "))
        }
    }
    else return { type: "success" }
}

function metadataTypeTest(route: RouteInfo, allRoutes: RouteInfo[]): Issue {
    const hasTypeInfo = route.action
        .parameters.some(x => Boolean(x.type))
    if (!hasTypeInfo && route.action.parameters.length > 0) {
        return {
            type: "warning",
            message: errorMessage.ActionDoesNotHaveTypeInfo
        }
    }
    else return { type: "success" }
}

function duplicateRouteTest(route: RouteInfo, allRoutes: RouteInfo[]): Issue {
    const dup = allRoutes.filter(x => x.url == route.url && x.method == route.method)
    if (dup.length > 1) {
        return {
            type: "error",
            message: errorMessage.DuplicateRouteFound.format(dup.map(x => getActionName(x)).join(" "))
        }
    }
    else return { type: "success" }
}

function modelTypeInfoTest(route: RouteInfo, allRoutes: RouteInfo[]): Issue {
    const classes = traverseModel(route.action.parameters)
        .filter(x => x.properties.every(par => typeof par.type == "undefined"))
        .map(x => x.type)
    //get only unique type
    const noTypeInfo = Array.from(new Set(classes))
    if (noTypeInfo.length > 0) {
        return {
            type: "warning",
            message: errorMessage.ModelWithoutTypeInformation.format(noTypeInfo.map(x => x.name).join(", "))
        }
    }
    else return { type: "success" }
}

function arrayTypeInfoTest(route: RouteInfo, allRoutes: RouteInfo[]): Issue {
    const issues = traverseArray(`${route.controller.name}.${route.action.name}`, route.action.parameters)
    const array = Array.from(new Set(issues))
    if (array.length > 0) {
        return {
            type: "warning",
            message: errorMessage.ArrayWithoutTypeInformation.format(array.join(", "))
        }
    }
    else return { type: 'success' }
}

/* ------------------------------------------------------------------------------- */
/* -------------------------------- ANALYZER ------------------------------------- */
/* ------------------------------------------------------------------------------- */

function analyzeRoute(route: RouteInfo, tests: AnalyzerFunction[], allRoutes: RouteInfo[]): TestResult {
    const issues = tests.map(test => {
        return test(route, allRoutes)
    })
        .filter(x => x.type != "success")
    return { route, issues }
}

export function analyzeRoutes(routes: RouteInfo[]) {
    const tests: AnalyzerFunction[] = [
        backingParameterTest, metadataTypeTest,
        duplicateRouteTest, modelTypeInfoTest,
        arrayTypeInfoTest
    ]
    return routes.map(x => analyzeRoute(x, tests, routes))
}

export function printAnalysis(results: TestResult[]) {
    const data = results.map(x => {
        const method = x.route.method.toUpperCase()
        const action = getActionName(x.route)
        const issues = x.issues.map(issue => ` - ${issue.type} ${issue!.message}`)
        return { method, url: x.route.url, action, issues }
    })
    console.log()
    console.log(chalk.bold("Route Analysis Report"))
    if (data.length == 0) console.log("No controller found")
    data.forEach((x, i) => {
        const num = (i + 1).toString().padStart(data.length.toString().length)
        const action = x.action.padEnd(Math.max(...data.map(x => x.action.length)))
        const method = x.method.padEnd(Math.max(...data.map(x => x.method.length)))
        //const url = x.url.padEnd(Math.max(...data.map(x => x.url.length)))
        const issueColor = (issue: string) => issue.startsWith(" - warning") ? chalk.yellow(issue) : chalk.red(issue)
        const color = x.issues.length == 0 ? (x: string) => x :
            x.issues.some(x => x.startsWith(" - warning")) ? chalk.yellow : chalk.red
        console.log(color(`${num}. ${action} -> ${method} ${x.url}`))
        x.issues.forEach(issue => console.log(issueColor(issue)))
    })
    if (data.length > 0) console.log()
}
