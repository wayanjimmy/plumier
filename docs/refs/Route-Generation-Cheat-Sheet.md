---
id: route
title: Route Cheat Sheet
---

Plumier generate routes directly from controllers. By default it will looks into the `./controller` directory. Except other directory or controller classes specified on the configuration.

> [Parameter destructuring](https://www.typescriptlang.org/docs/handbook/variable-declarations.html#function-declarations) is not supported on current route generator, consider to avoid them.

## Without Decorator

If no `@route` decorator provided, generated route will be of type GET. 
> Parameter binding will be ignored (due to no type information if no decorator provided)
> All data type assumed to be of type string even if you provided other type

```typescript
export class AnimalController {
    get(id:string){}
    list(last:string, limit:string)
}
```
```
GET /animal/get?id=<number>
GET /animal/list?last=<number>&limit=<number>
```

## Verb Route Override

Verb route override will only override the http verb of the route, route will be constructed using controller name (omit controller word) and action name

```typescript
export class AnimalController {
    @route.put()
    modify(id:number, model:AnimalDto)
    @route.post()
    save(model:AnimalDto){}
}
```
```
POST /animal/save
PUT  /animal/modify?id=<number>
```

## Absolute Route Override

Absolute route override (route start with `/`) will ignore all the controller and action name, instead it will used provided route.

```typescript
export class AnimalController {
    @route.get("/beast/:id")
    get(id:number){}
    @route.get("/beast/list")
    list(last:number, limit:number)
}
```
```
GET /beast/:id
GET /beast/list?last=<number>&limit=<number>
```

## Relative Route Override

Relative route override will only rename the name of the action and keep using controller name.

```typescript
export class AnimalController {
    @route.get(":id")
    get(id:number){}
    @route.get("list")
    list(last:number, limit:number)
}
```
```
GET /animal/:id
GET /animal/list?last=<number>&limit=<number>
```

## Ignore Action Name

You can provided empty string on the route parameter to ignore action name

```typescript
export class AnimalController {
    @route.get("")
    get(id:number){}
}
```
```
GET /animal?id=<number>
```

## Example Restful Api

Sum up of above rule you can create Restful API route like below:

```typescript
export class AnimalController {
    @route.get(":id")
    get(id:number){}
    @route.get("")
    getAll(){}
    @route.post("")
    save(animal:any)
    @route.put(":id")
    modify(id:number, animal:any)
    @route.delete(":id")
    delete(id:number){}
}
```
```
GET    /animal/:id
GET    /animal
POST   /animal
PUT    /animal/:id
DELETE /animal/:id
```

## Root Route

Root route only override the controller name

```typescript
@route.root("/beast")
export class AnimalController {
    get(id:number){}
    list(last:number, limit:number)
}
```
```
GET /beast/get?id=<number>
GET /beast/list?last=<number>&limit=<number>
```

## Parameterized Root Route

Root route can be parameterized and provided backing parameter on all of the action, except absolute route

```typescript
@route.root("/beast/:beastId")
export class AnimalController {
    get(beastId:number, id:number){}
    //absolute route doesn't need to provided backing parameter
    //fpr beastId
    @route.get("/list")
    list(last:number, limit:number)
}
```
```
GET /beast/<beastId>/get?id=<number>
GET /list?last=<number>&limit=<number>
```

## Example Nested Restful API

By using rules above you can configure nested restful api like below:

```typescript
@route.root("category/:type/animal")
export class AnimalController {
    @route.get(":id")
    get(type:string, id:number){}
    @route.get("")
    getAll(type:string){}
    @route.post("")
    save(type:string, animal:any)
    @route.put(":id")
    modify(type:string, id:number, animal:any)
    @route.delete(":id")
    delete(type:string, id:number){}
}
```
```
GET    category/:type/animal/:id
GET    category/:type/animal
POST   category/:type/animal
PUT    category/:type/animal/:id
DELETE category/:type/animal/:id
```

## Multiple Route Decorator
Multiple routes can be applied to an action, this functionalities needed for example when hosting an SPA with url rewrite

```typescript
export class HomeController {
    @route.get("/")
    @route.get("/home")
    @route.get("/about-us")
    @route.get("/cart")
    index(id:number){
        return response.file("<file path>")
    }
}
```

```
GET /
GET /home
GET /about-us
GET /cart
```


## Route Based On Controller Directory Hierarchy
Route generated based on controller directory hierarchy. For example if the controller hierarchy like below:

```
+ controller
  - home-controller.ts
  + api
    + v1
      - animal-controller.ts
    + v2
      - animal-controller.ts
- app.ts
```

Application setup:

```typescript
//app.ts
const app = new Plumier()
//setup controller directory on WebApiFacility (or RestfulApiFacility)
app.set(new WebApiFacility({ controller: "./controller" }))
    .initialize()
    .then(koa => koa.listen(8000))
```

Controllers

```typescript
//controller/home-controller.ts
export class HomeController {
    @route.get("/")
    index(){
        return "My Cool Animal API"
    }
}

//controller/api/v1/animal-controller.ts
export class AnimalController {
    @route.get("")
    get(){
        return { name: "Mimi" }
    }
}

//controller/api/v2/animal-controller.ts
export class AnimalController {
    @route.get(":id")
    get(id:string){
        return { name: "Mimi" }
    }

    @route.get("")
    all(){
        return [{ name: "Mimi" }]
    }
}
```

Route generated:

```
GET /
GET /api/v1/animal
GET /api/v2/animal/:id
GET /api/v2/animal
```

Note that AnimalController will have their own root route based on their directory.
