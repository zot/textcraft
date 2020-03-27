export var storage;
const centralDbName = 'textcraft';
const infoKey = 'info';
const locationIndex = 'locations';
const linkOwnerIndex = 'linkOwners';
const nameIndex = 'names';
const usersSuffix = ' users';
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
    constructor(id, name, description = '') {
        this._id = id;
        this.name = name;
        this.description = description;
    }
    get id() { return this._id; }
    get name() { return this._name; }
    set name(n) { this.markDirty(this._name = n); }
    get description() { return this._description; }
    set description(d) { this.markDirty(this._description = d); }
    get contents() { return this.world.getContents(this); }
    get location() { return this.world.getThing(this._location); }
    set location(t) { this.markDirty(this._location = t.id); }
    get links() { return this.world.getLinks(this); }
    get linkOwner() { return this.world.getThing(this._linkOwner); }
    set linkOwner(t) { this.markDirty(this._linkOwner = t && t.id); }
    get otherLink() { return this.world.getThing(this._otherLink); }
    set otherLink(t) { this.markDirty(this._otherLink = t && t.id); }
    markDirty(sideEffect) {
        this.world.markDirty(this);
    }
    spec() {
        return {
            id: this._id,
            name: this._name,
            description: this._description,
            location: this._location,
            linkOwner: this._linkOwner,
            otherLink: this._otherLink,
        };
    }
}
export class World {
    constructor(name, storage) {
        this.setName(name);
        this.storage = storage;
        this.dirty = new Set();
    }
    setName(name) {
        this.name = name;
        this.storeName = mudDbName(name);
        this.users = userDbName(name);
    }
    initDb() {
        return new Promise((succeed, fail) => {
            var req = storage.upgrade(async () => {
                await this.doTransaction(() => this.store());
                succeed();
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
        return this.doTransaction(async (store, users, txn) => this.useInfo(await store.get('info')));
    }
    useInfo(info) {
        this.nextId = info.nextId;
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
            return this.processTransaction(func)
                .finally(async () => {
                var store = this.txn.objectStore(this.storeName);
                await Promise.allSettled([...this.dirty].map(dirty => store.put(this.thingCache.get(dirty).spec())));
                this.txn = null;
                if (oldId != this.nextId) {
                    return this.store();
                }
            });
        }
    }
    store() {
        return promiseFor(this.txn.objectStore(this.storeName).put(this.spec()));
    }
    processTransaction(func) {
        var result = func(this.txn.objectStore(this.storeName), this.txn.objectStore(this.users), this.txn);
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
        return this.createUser(name, randomName('password'));
    }
    createUser(name, password) {
        return this.doTransaction(async (store, users, txn) => {
            let user = { name, password };
            await users.put(user);
            console.log('created user', user);
            return user;
        });
    }
    replaceUsers(newUsers) {
        return this.doTransaction(async (store, users, txn) => {
            await deleteAll(users);
            return Promise.all(newUsers.map(u => users.put(u)));
        });
    }
    replaceThings(newThings) {
        return this.doTransaction(async (store, users, txn) => {
            await deleteAll(store);
            this.useInfo(newThings.find(t => t.id == 'info'));
            return Promise.all(newThings.map(t => store.put(t)));
        });
    }
    getThing(id) {
        if (!id) {
            return null;
        }
        else {
            var cached = this.thingCache.get(id);
            if (cached) {
                return cached;
            }
        }
        this.doTransaction(async (store, users, txn) => this.cacheThingFor(await promiseFor(store.get(id))));
    }
    createThing(name, description = '') {
        var t = new Thing(this.nextId++, name, description);
        this.thingCache.set(t.id, t);
        this.doTransaction(async (store, users, txn) => {
            return await promiseFor(store.put(t));
        });
        return t;
    }
    storeThing(thing) {
        this.txn.objectStore(this.storeName).put(thing.spec());
    }
    cacheThingFor(thingSpec) {
        var thing = Object.assign(new Thing(null, null), thingSpec);
        this.thingCache.set(thing.id, thing);
        return thing;
    }
    async getContents(thing) {
        return await promiseFor(this.txn.objectStore(this.storeName).index(locationIndex).getAll(IDBKeyRange.only(thing.id)));
    }
    async getLinks(thing) {
        return await promiseFor(this.txn.objectStore(this.storeName).index(linkOwnerIndex).getAll(IDBKeyRange.only(thing.id)));
    }
    markDirty(thing) {
        this.dirty.add(thing.id);
    }
    spec() {
        return { id: infoKey, nextId: this.nextId, name: this.name };
    }
    async copyWorld(newName) {
        if (this.storage.hasWorld(newName)) {
            throw new Error('there is already a world named "' + newName + '"');
        }
        var newWorld = this.storage.openWorld(newName);
        var txn = this.db().transaction([this.storeName, newWorld.storeName], 'readwrite');
        var srcStore = txn.objectStore(this.storeName);
        var dstStore = txn.objectStore(newWorld.storeName);
        var evt = await rawPromiseFor(srcStore.openCursor());
        var cursor = evt.target.result;
        if (cursor) {
            while (cursor.value) {
                await promiseFor(dstStore.put(cursor.value));
                cursor.continue();
            }
        }
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
        var world = new World(name, this);
        if (!name) {
            for (;;) {
                name = randomName('mud');
                if (!this.hasWorld(name)) {
                    world.setName(name);
                    break;
                }
            }
        }
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
export function init(app) { }
//# sourceMappingURL=model.js.map