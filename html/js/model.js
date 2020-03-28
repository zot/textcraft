export var storage;
const centralDbName = 'textcraft';
const infoKey = 'info';
const locationIndex = 'locations';
const linkOwnerIndex = 'linkOwners';
const nameIndex = 'names';
const usersSuffix = ' users';
const spec2ThingProps = new Map([
    ['id', '_id'],
    ['prototype', '_prototype'],
    ['article', '_article'],
    ['name', '_name'],
    ['fullName', '_fullName'],
    ['description', '_description'],
    ['count', '_count'],
    ['location', '_location'],
    ['linkOwner', '_linkOwner'],
    ['otherLink', '_otherLink'],
    ['open', '_open'],
]);
const thing2SpecProps = new Map([
    ['_id', 'id'],
    ['_prototype', 'prototype'],
    ['_article', 'article'],
    ['_name', 'name'],
    ['_fullName', 'fullName'],
    ['_description', 'description'],
    ['_count', 'count'],
    ['_location', 'location'],
    ['_linkOwner', 'linkOwner'],
    ['_otherLink', 'otherLink'],
    ['_open', 'open'],
]);
/*
 * ## The Thing class
 *
 * The World is made of things, and only things. Each room is a thing. Exits between rooms are things. People are things. Items are things. Boxes are things.
 *
 *  Bill's good friend, Fritz Passow, came up with this idea, which he called "Container MUD", where everything is a container.
 *
 * The Thing class has these properties:
 *
 * * id: an identifying number for this thing, unique among things
 * * name: the name; since this is used in commands, spaces are not allowed
 * * description: the description
 * * location: the thing this is located in -- if this is a link, it has no location
 * * contents: things inside this thing
 * * links: links (which are things) attached to this thing
 * * linkOwner: the thing that owns this link, if this is a link
 * * otherLink: the companion to this link, if this is a link
 */
export class Thing {
    constructor(id, name, description = null) {
        this._id = id;
        this._fullName = name;
        this._name = name.split(/ +/)[0];
        if (typeof description != 'undefined')
            this._description = description;
        this._open = true;
        this._location = null;
        this._linkOwner = null;
        this._otherLink = null;
    }
    get id() { return this._id; }
    get article() { return this._article; }
    set article(a) { this._article = a; }
    get count() { return this._count; }
    set count(n) { this._count = n; }
    get name() { return this._name; }
    set name(n) { this.markDirty(this._name = n); }
    get fullName() { return this._fullName; }
    set fullName(n) {
        this.markDirty(this._fullName = n);
        this._name = n.split(/ +/)[0].toLowerCase();
    }
    get description() { return this._description; }
    set description(d) { this.markDirty(this._description = d); }
    get open() { return this._open; }
    set open(b) { this.markDirty(this._open = b); }
    getContents() { return this.world.getContents(this); }
    getPrototype() { return this.world.getThing(this._prototype); }
    setPrototype(t) {
        this.markDirty(null);
        if (t) {
            this._prototype = t.id;
            this.__proto__ = t;
        }
        else {
            this._prototype = null;
        }
    }
    getLocation() { return this.world.getThing(this._location); }
    setLocation(t) { this.markDirty(this._location = t.id); }
    getLinks() { return this.world.getLinks(this); }
    getLinkOwner() { return this.world.getThing(this._linkOwner); }
    setLinkOwner(t) { this.markDirty(this._linkOwner = t && t.id); }
    getOtherLink() { return this.world.getThing(this._otherLink); }
    setOtherLink(t) { this.markDirty(this._otherLink = t && t.id); }
    formatName() {
        return (this.article ? this.article + ' ' : '') + this.fullName;
    }
    markDirty(sideEffect) {
        this.world.markDirty(this);
    }
    async find(name, exclude = new Set()) {
        if (exclude.has(this)) {
            return null;
        }
        else if (this.name.toLowerCase() == name.toLowerCase()) {
            return this;
        }
        exclude.add(this);
        for (let item of await this.getContents()) {
            var result = await item.find(name, exclude);
            if (result) {
                return result;
            }
        }
        var loc = await this.getLocation();
        if (loc) {
            var result = await loc.find(name, exclude);
            if (result)
                return result;
        }
        var owner = await this.getLinkOwner();
        if (owner) {
            var result = await owner.find(name, exclude);
            if (result)
                return result;
        }
        return null;
    }
    store() {
        return this.world.putThing(this);
    }
    spec() {
        var spec = {};
        for (let prop of thing2SpecProps.keys()) {
            if (prop in this) {
                spec[thing2SpecProps.get(prop)] = this[prop];
            }
        }
        return spec;
    }
    async useSpec(spec) {
        for (let prop in spec) {
            this[spec2ThingProps.get(prop)] = spec[prop];
        }
        if (spec.prototype) {
            var proto = await this.world.getThing(spec.prototype);
            if (!proto) {
                throw new Error('Could not find prototype ' + spec.prototype);
            }
            this.__proto__ = proto;
        }
    }
}
export class World {
    constructor(name, storage) {
        this.setName(name);
        this.storage = storage;
        this.dirty = new Set();
        this.thingCache = new Map();
        this.nextId = 0;
    }
    setName(name) {
        this.name = name;
        this.storeName = mudDbName(name);
        this.users = userDbName(name);
    }
    initDb() {
        return new Promise((succeed, fail) => {
            var req = storage.upgrade(() => {
                return this.doTransaction(async (store, users, txn) => {
                    var limbo = await this.createThing('Limbo', 'You are floating in $this');
                    this.limbo = limbo.id;
                    limbo.markDirty(limbo._location = this.limbo);
                    limbo.article = null;
                    var lobby = await this.createThing('Lobby', 'You are in $this');
                    lobby.markDirty(this.lobby = lobby.id);
                    var protos = await this.createThing('Hall of Prototypes', 'You are in $this');
                    protos.markDirty(this.hallOfPrototypes = protos.id);
                    var thingProto = await this.createThing('thing', 'This is $this');
                    this.thingProto = thingProto;
                    thingProto.markDirty(thingProto._location = this.hallOfPrototypes);
                    var roomProto = await this.createThing('room', 'You are in $this');
                    this.roomProto = roomProto;
                    roomProto.markDirty(roomProto._location = this.hallOfPrototypes);
                    roomProto._prototype = thingProto.id;
                    limbo._prototype = roomProto.id;
                    lobby._prototype = roomProto.id;
                    protos._prototype = roomProto.id;
                    var personProto = await this.createThing('person', '$This $is only a dude');
                    this.personProto = personProto;
                    personProto.markDirty(personProto._location = this.hallOfPrototypes);
                    personProto._prototype = thingProto.id;
                    personProto._article = '';
                    this.store();
                    succeed();
                });
            });
            req.onupgradeneeded = () => {
                var txn = req.transaction;
                //var userStore = txn.db.createObjectStore(this.users, {autoIncrement: true})
                var userStore = txn.db.createObjectStore(this.users, { keyPath: 'name' });
                var thingStore = txn.db.createObjectStore(this.storeName, { keyPath: 'id' });
                //userStore.createIndex(nameIndex, 'name', {unique: true}) // look up users by name
                thingStore.createIndex(locationIndex, 'location', { unique: false });
                thingStore.createIndex(linkOwnerIndex, 'linkOwner', { unique: false });
            };
            req.onerror = fail;
        });
    }
    loadInfo() {
        return this.doTransaction(async (store, users, txn) => this.useInfo(await promiseFor(store.get('info'))));
    }
    async useInfo(info) {
        this.nextId = info.nextId;
        this.name = info.name;
        this.lobby = info.lobby;
        this.limbo = info.limbo;
        this.hallOfPrototypes = info.hallOfPrototypes;
        this.thingProto = await this.getThing(info.thingProto);
        this.roomProto = await this.getThing(info.roomProto);
    }
    spec() {
        return {
            id: infoKey,
            nextId: this.nextId,
            name: this.name,
            lobby: this.lobby,
            limbo: this.limbo,
            hallOfPrototypes: this.hallOfPrototypes,
            thingProto: this.thingProto.id,
            roomProto: this.roomProto.id,
        };
    }
    rename(newName) {
        this.storage.renameWorld(this.name, newName);
    }
    delete() {
        this.storage.deleteWorld(this.name);
    }
    db() {
        return this.storage.db;
    }
    // perform a transaction, then write all dirty things to storage
    async doTransaction(func) {
        if (this.txn) {
            return this.processTransaction(func);
        }
        else {
            var txn = this.db().transaction([this.storeName, this.users], 'readwrite');
            var oldId = this.nextId;
            this.txn = txn;
            this.thingStore = txn.objectStore(this.storeName);
            this.userStore = txn.objectStore(this.users);
            return this.processTransaction(func)
                .finally(async () => {
                await Promise.allSettled([...this.dirty].map(dirty => this.thingCache.get(dirty).store()));
                this.dirty = new Set();
                if (oldId != this.nextId) {
                    this.store();
                }
                this.txn = null;
                this.thingStore = this.userStore = null;
            });
        }
    }
    store() {
        return promiseFor(this.thingStore.put(this.spec()));
    }
    processTransaction(func) {
        var result = func(this.thingStore, this.userStore, this.txn);
        return result instanceof Promise ? result : Promise.resolve(result);
    }
    getUser(name) {
        return this.doTransaction(async (store, users, txn) => await promiseFor(users.get(name)));
    }
    deleteUser(name) {
        return this.doTransaction(async (store, users, txn) => {
            return new Promise((succeed, fail) => {
                var req = users.index(nameIndex).openCursor(name);
                req.onsuccess = evt => {
                    if (evt.target.result) {
                        var dreq = evt.target.result.delete();
                        dreq.onsuccess = succeed;
                        dreq.onerror = fail;
                    }
                    else {
                        succeed();
                    }
                };
                req.onerror = fail;
            });
        });
    }
    async getAllUsers() {
        var userList = [];
        return new Promise((succeed, fail) => {
            this.doTransaction(async (store, users, txn) => {
                var req = users.openCursor();
                req.onsuccess = evt => {
                    let cursor = evt.target.result;
                    if (cursor) {
                        userList.push(cursor.value);
                        console.log('found user', cursor.value);
                        cursor.continue();
                    }
                    else {
                        console.log('no more users');
                        succeed(userList);
                    }
                };
                req.onerror = evt => {
                    console.log('failure: ', evt);
                    fail(evt);
                };
            });
        });
    }
    randomUserName() {
        return this.doTransaction(async (store, users, txn) => {
            for (;;) {
                let name = randomName('user');
                if (!await this.getUser(name)) {
                    return name;
                }
            }
        });
    }
    async createRandomUser() {
        var name = await this.randomUserName();
        return this.createUser(name, randomName('password'), false);
    }
    createUser(name, password, admin) {
        return this.doTransaction(async (store, users, txn) => {
            let user = { name, password, admin };
            await this.putUser(user);
            console.log('created user', user);
            return user;
        });
    }
    putUser(user) {
        return promiseFor(this.userStore.put(user));
    }
    putThing(thing) {
        return promiseFor(this.thingStore.put(thing.spec()));
    }
    replaceUsers(newUsers) {
        return this.doTransaction(async (store, users, txn) => {
            await deleteAll(users);
            return Promise.all(newUsers.map(u => this.putUser(u)));
        });
    }
    replaceThings(newThings) {
        return this.doTransaction(async (store, users, txn) => {
            await deleteAll(store);
            await this.useInfo(newThings.find(t => t.id == 'info'));
            return Promise.all(newThings.map(t => this.putThing(t)));
        });
    }
    async getThing(tip) {
        var id;
        if (typeof tip == 'number') {
            id = tip;
        }
        else if (tip instanceof Thing) {
            return Promise.resolve(tip);
        }
        else if (tip instanceof Promise) {
            return await tip;
        }
        else {
            return null;
        }
        var cached = this.thingCache.get(id);
        if (cached) {
            return Promise.resolve(cached);
        }
        return this.doTransaction(async (store) => this.cacheThingFor(await promiseFor(store.get(id))));
    }
    authenticate(name, passwd) {
        return this.doTransaction(async (store, users, txn) => {
            var user = await promiseFor(users.get(name));
            if (!user || user.password != passwd) {
                throw new Error('Bad user or password');
            }
            if (!user.thing) {
                var thing = await this.createThing(name, 'Just some dude');
                thing.markDirty(thing._location = this.lobby);
                if (this.personProto)
                    thing.setPrototype(this.personProto);
                thing.article = '';
                user.thing = thing.id;
                await this.putUser(user);
                return [thing, user.admin];
            }
            else {
                return [await this.getThing(user.thing), user.admin];
            }
        });
    }
    createThing(name, description = '') {
        var t = new Thing(this.nextId++, name, description);
        t.world = this;
        t._location = this.limbo;
        if (this.thingProto)
            t.setPrototype(this.thingProto);
        t._count = 1;
        this.thingCache.set(t.id, t);
        this.doTransaction(async () => {
            return await this.putThing(t);
        });
        return t;
    }
    cacheThingFor(thingSpec) {
        var thing = new Thing(null, '');
        thing.world = this;
        thing.useSpec(thingSpec);
        this.thingCache.set(thing.id, thing);
        return thing;
    }
    async cacheThings(specs) {
        for (let i = 0; i < specs.length; i++) {
            var thing = this.thingCache.get(specs[i].id);
            specs[i] = thing || this.cacheThingFor(specs[i]);
        }
        return specs;
    }
    getContents(thing) {
        let id = typeof thing == 'number' ? thing : thing.id;
        return this.doTransaction(async (things) => {
            return this.cacheThings(await promiseFor(things.index(locationIndex).getAll(IDBKeyRange.only(id))));
        });
    }
    getLinks(thing) {
        return this.doTransaction(async (things) => {
            return this.cacheThings(await promiseFor(this.thingStore.index(linkOwnerIndex).getAll(IDBKeyRange.only(thing.id))));
        });
    }
    async getAncestors(thing, ancestors = []) {
        if (thing._prototype) {
            return this.doTransaction(async () => {
                var proto = await thing.getPrototype();
                this.getAncestors(proto, ancestors);
                return ancestors;
            });
        }
        else {
            return ancestors;
        }
    }
    markDirty(thing) {
        this.dirty.add(thing.id);
    }
    async copyWorld(newName) {
        if (this.storage.hasWorld(newName)) {
            throw new Error('there is already a world named "' + newName + '"');
        }
        var newWorld = await this.storage.openWorld(newName);
        var txn = this.db().transaction([this.storeName, newWorld.storeName, this.users, newWorld.users], 'readwrite');
        var newThings = txn.objectStore(newWorld.storeName);
        await copyAll(txn.objectStore(this.users), txn.objectStore(newWorld.users));
        await copyAll(txn.objectStore(this.storeName), newThings);
        var newInfo = await promiseFor(newThings.get('info'));
        newInfo.name = newName;
        return promiseFor(newThings.put(newInfo));
    }
}
export class MudStorage {
    constructor(db) {
        this.db = db;
        this.worlds = [];
        this.openWorlds = new Map();
    }
    hasWorld(name) {
        return contains([...this.worlds], name);
    }
    async openWorld(name = '') {
        if (this.openWorlds.has(name)) {
            return this.openWorlds.get(name);
        }
        if (!name) {
            name = this.randomWorldName();
        }
        var world = new World(name, this);
        if (!this.hasWorld(name)) {
            this.worlds.push(name);
            this.store();
            await world.initDb();
        }
        else {
            await world.loadInfo();
        }
        this.openWorlds.set(name, world);
        return world;
    }
    randomWorldName() {
        var name;
        for (;;) {
            name = randomName('mud');
            if (!this.hasWorld(name)) {
                return name;
            }
        }
    }
    store() {
        var txn = this.db.transaction(centralDbName, 'readwrite');
        var store = txn.objectStore(centralDbName);
        return promiseFor(store.put(this.spec(), infoKey));
    }
    spec() {
        return { worlds: this.worlds };
    }
    upgrade(then) {
        var version = this.db.version;
        this.db.close();
        var req = indexedDB.open(centralDbName, ++version);
        req.onsuccess = evt => {
            this.db = req.result;
            then(evt);
        };
        return req;
    }
    deleteWorld(name) {
        return new Promise((succeed, fail) => {
            var index = this.worlds.indexOf(name);
            if (index != -1) {
                var req = this.upgrade(async () => {
                    await this.store();
                    return succeed();
                });
                req.onupgradeneeded = () => {
                    var txn = req.transaction;
                    this.db = req.result;
                    this.worlds.splice(index, 1);
                    this.openWorlds.delete(name);
                    txn.db.deleteObjectStore(mudDbName(name));
                    txn.db.deleteObjectStore(userDbName(name));
                };
                req.onerror = fail;
            }
            else {
                fail(new Error('There is no world named ' + name));
            }
        });
    }
    renameWorld(name, newName) {
        var index = this.worlds.indexOf(name);
        return new Promise((succeed, fail) => {
            if (name != newName && index != -1 && !this.hasWorld(newName)) {
                var req = this.upgrade(() => {
                    console.log('STORING MUD INFO');
                    this.store();
                    succeed();
                });
                req.onupgradeneeded = () => {
                    var txn = req.transaction;
                    this.db = req.result;
                    this.worlds[index] = newName;
                    this.openWorlds.set(newName, this.openWorlds.get(name));
                    this.openWorlds.delete(name);
                    txn.objectStore(mudDbName(name)).name = mudDbName(newName);
                    txn.objectStore(userDbName(name)).name = userDbName(newName);
                };
                req.onerror = fail;
            }
            else if (name == newName) {
                succeed();
            }
            else if (index == -1) {
                fail(new Error('There is no world named ' + name));
            }
            else {
                fail(new Error('There is already a world named ' + newName));
            }
        });
    }
    async strippedBlobForWorld(name) {
        var index = this.worlds.indexOf(name);
        if (index == -1) {
            return Promise.reject(new Error('No world found named ' + name));
        }
        return new Promise(async (succeed, fail) => {
            var txn = this.db.transaction([mudDbName(name)]);
            return blobForDb(await txn.objectStore(mudDbName(name)));
        });
    }
    fullBlobForWorld(name) {
        var index = this.worlds.indexOf(name);
        var records = ['{"objects":'];
        if (index == -1) {
            return Promise.reject(new Error('No world found named ' + name));
        }
        return new Promise(async (succeed, fail) => {
            var txn = this.db.transaction([mudDbName(name), userDbName(name)]);
            await jsonObjectsForDb(txn.objectStore(mudDbName(name)), records);
            records.push(', "users":');
            await jsonObjectsForDb(txn.objectStore(userDbName(name)), records);
            records.push('}');
            succeed(blobForJsonObjects(records));
        });
    }
    uploadWorld(world) {
        return world.users ? this.uploadFullWorld(world)
            : this.uploadStrippedWorld(world);
    }
    async uploadFullWorld(worldAndUsers) {
        var users = worldAndUsers.users;
        var objects = worldAndUsers.objects;
        var info = objects.find(i => i.id == 'info');
        var world = await this.openWorld(info.name);
        world.doTransaction(async (thingStore, userStore, txn) => {
            await world.replaceUsers(users);
            return this.uploadStrippedWorld(objects, world);
        });
    }
    async uploadStrippedWorld(objects, world = null) {
        if (world) {
            return world.replaceThings(objects);
        }
        else {
            var info = objects.find(i => i.id == 'info');
            world = await this.openWorld(info.name);
            return world.replaceThings(objects);
        }
    }
}
export function blobForJsonObjects(objects) {
    return new Blob(objects, { type: 'application/json' });
}
export async function blobForDb(objectStore) {
    return blobForJsonObjects(await jsonObjectsForDb(objectStore));
}
export function jsonObjectsForDb(objectStore, records = []) {
    return new Promise((succeed, fail) => {
        var req = objectStore.openCursor();
        var first = true;
        records.push('[');
        req.onsuccess = evt => {
            let cursor = evt.target.result;
            if (cursor) {
                if (first) {
                    first = false;
                }
                else {
                    records.push(',');
                }
                records.push(JSON.stringify(cursor.value));
                cursor.continue();
            }
            else {
                records.push(']');
                succeed(records);
            }
        };
        req.onerror = evt => {
            console.log('failure: ', evt);
            fail(evt);
        };
    });
}
export function identity(x) {
    return x;
}
export function sanitizeName(name) {
    return name.replace(/ /, '_');
}
export async function getStorage() {
    return storage || await openStorage();
}
export function openStorage() {
    return new Promise((succeed, fail) => {
        console.log('opening storage');
        var req = indexedDB.open(centralDbName);
        console.log('req', req);
        req.onupgradeneeded = () => {
            var db = req.result;
            var txn = req.transaction;
            storage = new MudStorage(db);
            var objectStore = db.createObjectStore(centralDbName);
            var store = txn.objectStore(centralDbName);
            store.put(storage.spec(), infoKey);
        };
        req.onsuccess = async (evt) => {
            var db = req.result;
            var txn = db.transaction(centralDbName, 'readwrite');
            var store = txn.objectStore(centralDbName);
            if (!storage) {
                storage = new MudStorage(db);
            }
            var result = await promiseFor(store.get(infoKey));
            console.log('got storage spec', result);
            succeed(Object.assign(storage, result));
        };
    });
}
export function promiseFor(req) {
    if (req instanceof IDBRequest) {
        return new Promise((succeed, fail) => {
            req.onerror = fail;
            req.onsuccess = () => succeed(req.result);
        });
    }
    else {
        return new Promise((succeed, fail) => {
            req.onerror = fail;
            req.oncomplete = () => succeed();
        });
    }
}
export function rawPromiseFor(req) {
    if (req instanceof IDBRequest) {
        return new Promise((succeed, fail) => {
            req.onerror = fail;
            req.onsuccess = succeed;
        });
    }
    else {
        return new Promise((succeed, fail) => {
            req.onerror = fail;
            req.oncomplete = succeed;
        });
    }
}
export function contains(array, item) {
    return array.indexOf(item) != -1;
}
function mudDbName(name) {
    return 'world ' + name;
}
function userDbName(name) {
    return 'world ' + name + usersSuffix;
}
export function randomName(prefix) {
    return prefix + Math.round(Math.random() * 10000000);
}
function deleteAll(store) {
    return new Promise((succeed, fail) => {
        let req = store.openCursor();
        req.onerror = fail;
        req.onsuccess = evt => {
            let cursor = evt.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
            else {
                succeed(null);
            }
        };
    });
}
async function copyAll(srcStore, dstStore) {
    await deleteAll(dstStore);
    return new Promise((succeed, fail) => {
        let req = srcStore.openCursor();
        req.onerror = fail;
        req.onsuccess = async (evt) => {
            let cursor = evt.target.result;
            if (cursor) {
                await dstStore.put(cursor.value);
                cursor.continue();
            }
            else {
                succeed(null);
            }
        };
    });
}
export function init(app) { }
//# sourceMappingURL=model.js.map