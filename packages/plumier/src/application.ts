import Debug from "debug";
import { existsSync } from "fs";
import Koa, { Context } from "koa";
import { join } from "path";
import { inspect } from "util";

import { bindParameter } from "./binder";
import {
    ActionResult,
    Application,
    Configuration,
    DefaultDependencyResolver,
    errorMessage,
    Facility,
    hasKeyOf,
    Invocation,
    KoaMiddleware,
    Middleware,
    PlumierApplication,
    PlumierConfiguration,
    StringUtil,
    b,
} from "./framework";
import { analyzeRoutes, extractDecorators, printAnalysis, router, transformModule } from "./router";


const log = Debug("plum:app")

/* ------------------------------------------------------------------------------- */
/* ------------------------------- INVOCATIONS ----------------------------------- */
/* ------------------------------------------------------------------------------- */

export class MiddlewareInvocation implements Invocation {
    constructor(private middleware: Middleware, public context: Context, private next: Invocation) { }
    proceed(): Promise<ActionResult> {
        return this.middleware.execute(this.next)
    }
}

export class ActionInvocation implements Invocation {
    constructor(public context: Context) { }
    async proceed(): Promise<ActionResult> {
        const { request, route, config } = this.context
        const controller: any = config.dependencyResolver.resolve(route.controller.object)
        const parameters = bindParameter(request, route.action, config.converters)
        const result = (<Function>controller[route.action.name]).apply(controller, parameters)
        const status = config.responseStatus && config.responseStatus[route.method] || 200
        if (result instanceof ActionResult) {
            result.status = result.status || status
            log(`[Action Invocation] Method: ${b(route.method)} Status config: ${b(inspect(config.responseStatus, false, null))} Status: ${b(result.status)} `)        
            return Promise.resolve(result);
        }
        else {
            const awaitedResult = await Promise.resolve(result)
            log(`[Action Invocation] Method: ${route.method} Status config: ${b(inspect(config.responseStatus, false, null))} Status: ${b(status)} `)        
            return new ActionResult(awaitedResult, status)
        }
    }
}


/* ------------------------------------------------------------------------------- */
/* ------------------------- MIDDLEWARE PIPELINE --------------------------------- */
/* ------------------------------------------------------------------------------- */

export function pipe(middleware: Middleware[], context: Context, invocation: Invocation) {
    return middleware.reverse().reduce((prev: Invocation, cur) => new MiddlewareInvocation(cur, context, prev), invocation)
}

/* ------------------------------------------------------------------------------- */
/* --------------------------- REQUEST HANDLER ----------------------------------- */
/* ------------------------------------------------------------------------------- */

async function requestHandler(ctx:Context){
    const controllerMiddleware = extractDecorators(ctx.route)
    const pipeline = pipe(controllerMiddleware, ctx, new ActionInvocation(ctx))
    const result = await pipeline.proceed()
    result.execute(ctx)
    log(`[Request Handler] ${b(ctx.path)} -> ${b(ctx.route.controller.name)}.${b(ctx.route.action.name)}`)
    log(`[Request Handler] Request Query: ${b(inspect(ctx.query, false, null))}`)
    log(`[Request Handler] Request Header: ${b(inspect(ctx.headers, false, null))}`)
    log(`[Request Handler] Request Body: ${b(inspect(result.body, false, null))}`)
}

/* ------------------------------------------------------------------------------- */
/* --------------------------- MAIN APPLICATION ---------------------------------- */
/* ------------------------------------------------------------------------------- */


export class Plumier implements PlumierApplication {
    readonly config: Readonly<PlumierConfiguration>;
    readonly koa: Koa

    constructor() {
        this.koa = new Koa()
        this.config = {
            mode: "debug",
            middleware: [],
            facilities: [],
            rootPath: process.cwd(),
            controllerPath: "./controller",
            dependencyResolver: new DefaultDependencyResolver()
        }
    }

    use(option: KoaMiddleware): Application
    use(option: Middleware): Application
    use(option: KoaMiddleware | Middleware): Application {
        if (typeof option === "function") {
            this.koa.use(option)
        }
        else {
            this.koa.use(Middleware.toKoa(option))
        }
        return this
    }

    set(facility: Facility): Application
    set(config: Partial<Configuration>): Application
    set(config: Partial<Configuration> | Facility): Application {
        if (hasKeyOf<Facility>(config, "setup"))
            this.config.facilities.push(config)
        else
            Object.assign(this.config, config)
        return this;
    }

    async initialize(): Promise<Koa> {
        try {
            const controllerPath = join(this.config.rootPath, this.config.controllerPath)
            if (!existsSync(controllerPath))
                throw new Error(StringUtil.format(errorMessage.ControllerPathNotFound, controllerPath))
            const routes = await transformModule(controllerPath)
            if (this.config.mode === "debug") printAnalysis(analyzeRoutes(routes))
            await Promise.all(this.config.facilities.map(x => x.setup(this)))
            this.koa.use(router(routes, this.config, requestHandler))
            return this.koa
        }
        catch (e) {
            throw e
        }
    }
}