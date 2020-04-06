import proto from './protocol-shim.js';
export let storage;
const jsyaml = window.jsyaml;
const centralDbName = 'textcraft';
const infoKey = 'info';
const locationIndex = 'locations';
const userThingIndex = 'things';
const linkOwnerIndex = 'linkOwners';
const nameIndex = 'names';
const usersSuffix = ' users';
const extensionsSuffix = ' extensions';
const extensionNameIndex = 'names';
const extensionHashIndex = 'hashes';
let app;
export class Extension {
    constructor(obj) {
        Object.assign(this, obj);
    }
    async getHash() {
        return this.hash || (this.hash = toHex(new Int8Array(await crypto.subtle.digest('sha-256', proto.utfEncoder.encode(this.text)))));
    }
    async populate(file) {
        this.name = file.name;
        this.text = await file.text();
        return this.getHash();
    }
}
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
    constructor(id, name, description) {
        this._id = id;
        this.fullName = name;
        if (typeof description !== 'undefined')
            this._description = description;
        this._location = null;
        this._linkOwner = null;
        this._otherLink = null;
    }
    get id() { return this._id; }
    get article() { return this._article; }
    set article(a) { this._article = a; }
    get name() { return this._name; }
    set name(n) { this.markDirty(this._name = n); }
    get fullName() { return this._fullName; }
    set fullName(n) {
        n = n.trim();
        const [article, name] = findSimpleName(n);
        this.markDirty(null);
        if (article && n.substring(0, article.length) === article) {
            n = n.substring(article.length).trim();
        }
        if (article)
            this._article = article;
        this._name = escape(name);
        this._fullName = escape(n);
    }
    get description() { return this._description; }
    set description(d) { this.markDirty(this._description = d); }
    get contentsFormat() { return this._contentsFormat; }
    set contentsFormat(f) { this.markDirty(this._contentsFormat = f); }
    get examineFormat() { return this._examineFormat; }
    set examineFormat(f) { this.markDirty(this._examineFormat = f); }
    get linkFormat() { return this._linkFormat; }
    set linkFormat(f) { this.markDirty(this._linkFormat = f); }
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
    setLocation(t) { this.markDirty(this._location = idFor(t)); }
    getLinks() { return this.world.getLinks(this); }
    getLinkOwner() { return this.world.getThing(this._linkOwner); }
    setLinkOwner(t) { this.markDirty(this._linkOwner = t && t.id); }
    getOtherLink() { return this.world.getThing(this._otherLink); }
    setOtherLink(t) { this.markDirty(this._otherLink = t && t.id); }
    formatName() {
        return (this.article ? this.article + ' ' : '') + this.fullName;
    }
    markDirty(sideEffect) {
        this.world?.markDirty(this);
    }
    async find(name, exclude = new Set([])) {
        if (exclude.has(this)) {
            return null;
        }
        else if (this.name.toLowerCase() === name.toLowerCase()) {
            return this;
        }
        exclude.add(this);
        for (const item of await this.getContents()) {
            const result = await item.find(name, exclude);
            if (result) {
                return result;
            }
        }
        for (const item of await this.getLinks()) {
            const result = await item.find(name, exclude);
            if (result) {
                return result;
            }
        }
        const loc = await this.getLocation();
        if (loc) {
            const result = await loc.find(name, exclude);
            if (result)
                return result;
        }
        const owner = await this.getLinkOwner();
        if (owner) {
            const result = await owner.find(name, exclude);
            if (result)
                return result;
        }
        return null;
    }
    store() {
        return this.world.putThing(this);
    }
    spec() {
        const spec = {};
        for (const prop of Object.keys(this)) {
            if (prop[0] === '_') {
                spec[prop.substring(1)] = this[prop];
            }
        }
        return spec;
    }
    async useSpec(spec) {
        for (const prop of Object.keys(spec)) {
            this['_' + prop] = spec[prop];
        }
        if (spec.prototype) {
            const prototype = await this.world.getThing(spec.prototype);
            if (!prototype) {
                throw new Error('Could not find prototype ' + spec.prototype);
            }
            this.__proto__ = prototype;
        }
    }
}
export class World {
    constructor(name, stg) {
        this.setName(name);
        this.storage = stg;
        this.dirty = new Set();
        this.thingCache = new Map();
        this.nextId = 0;
    }
    close() {
        this.storage.closeWorld(this.name);
    }
    setName(name) {
        this.name = name;
        this.storeName = mudDbName(name);
        this.users = userDbName(name);
        this.extensionsName = extensionDbName(name);
    }
    initDb() {
        return new Promise((succeed, fail) => {
            const req = storage.upgrade(() => {
                return this.doTransaction(async (store, users, txn) => {
                    const limbo = await this.createThing('Limbo', 'You are floating in $this<br>$links<br><br>$contents');
                    this.limbo = limbo.id;
                    const lobby = await this.createThing('Lobby', 'You are in $this');
                    this.lobby = lobby.id;
                    const protos = await this.createThing('Hall of Prototypes');
                    this.hallOfPrototypes = protos.id;
                    this.thingProto = await this.createThing('thing', 'This is $this');
                    this.linkProto = await this.createThing('link', '$This to $link');
                    this.roomProto = await this.createThing('room', 'You are in $this');
                    this.personProto = await this.createThing('person', '$This $is only a dude');
                    limbo.setPrototype(this.roomProto);
                    lobby.setPrototype(this.roomProto);
                    protos.setPrototype(this.roomProto);
                    await this.store();
                    succeed();
                });
            });
            req.onupgradeneeded = () => {
                const txn = req.transaction;
                //let userStore = txn.db.createObjectStore(this.users, {autoIncrement: true})
                const userStore = txn.db.createObjectStore(this.users, { keyPath: 'name' });
                const thingStore = txn.db.createObjectStore(this.storeName, { keyPath: 'id' });
                userStore.createIndex(userThingIndex, 'thing', { unique: true });
                thingStore.createIndex(locationIndex, 'location', { unique: false });
                thingStore.createIndex(linkOwnerIndex, 'linkOwner', { unique: false });
            };
            req.onerror = fail;
        });
    }
    loadInfo() {
        return this.doTransaction(async (store, users, txn) => {
            this.thingStore = store;
            this.userStore = users;
            await this.useInfo(await promiseFor(store.get('info')));
        }, true);
    }
    async useInfo(info) {
        this.nextId = info.nextId;
        this.name = info.name;
        this.lobby = info.lobby;
        this.limbo = info.limbo;
        this.hallOfPrototypes = info.hallOfPrototypes;
        this.thingProto = await this.getThing(info.thingProto);
        this.personProto = await this.getThing(info.personProto);
        this.roomProto = (await this.getThing(info.personProto)) || await this.findPrototype('room');
        this.linkProto = (await this.getThing(info.personProto)) || await this.findPrototype('link');
    }
    async findPrototype(name) {
        for (const aproto of await (await this.getThing(this.hallOfPrototypes)).getContents()) {
            if (name === aproto.name)
                return aproto;
        }
    }
    async initStdPrototypes() {
        return this.doTransaction(async () => {
            const thingProto = this.thingProto;
            const personProto = this.personProto;
            const roomProto = this.roomProto;
            const linkProto = this.linkProto;
            thingProto.markDirty(thingProto._location = this.hallOfPrototypes);
            thingProto.article = 'the';
            thingProto.contentsFormat = '$This $is here';
            thingProto._contentsEnterFormat = '$forme You go into $this $forothers $Arg goes into $this';
            thingProto.examineFormat = 'Exits: $links<br>Contents: $contents';
            thingProto.linkFormat = '$This leads to $link';
            thingProto._keys = [];
            thingProto._template = false;
            thingProto._locked = false;
            linkProto.markDirty(linkProto._location = this.hallOfPrototypes);
            linkProto.article = '';
            linkProto._cmd = 'go $1';
            linkProto._linkEnterFormat = '$Arg1 enters $arg2';
            linkProto._linkMoveFormat = 'You went $name to $arg3';
            linkProto._linkExitFormat = '$Arg1 went $name to $arg2';
            linkProto._lockPassFormat = '$forme You open $this and go through to $arg2 $forothers $Arg open$s $this and go$s through to $arg2';
            linkProto._lockFailFormat = 'You cannot go $this because it is locked';
            roomProto.markDirty(roomProto._location = this.hallOfPrototypes);
            roomProto._closed = true;
            roomProto.setPrototype(thingProto);
            personProto.markDirty(personProto._location = this.hallOfPrototypes);
            personProto.setPrototype(thingProto);
            personProto._article = '';
        });
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
            personProto: this.personProto.id,
        };
    }
    rename(newName) {
        return this.storage.renameWorld(this.name, newName);
    }
    delete() {
        return this.storage.deleteWorld(this.name);
    }
    db() {
        return this.storage.db;
    }
    // perform a transaction, then write all dirty things to storage
    async doTransaction(func, allowIdChange = false) {
        if (this.txn) {
            return this.processTransaction(func);
        }
        else {
            const txn = this.db().transaction([this.storeName, this.users], 'readwrite');
            const oldId = this.nextId;
            this.txn = txn;
            this.thingStore = txn.objectStore(this.storeName);
            this.userStore = txn.objectStore(this.users);
            return this.processTransaction(func)
                .finally(async () => {
                await Promise.allSettled([...this.dirty].map(dirty => this.thingCache.get(dirty).store()));
                this.dirty = new Set();
                if (oldId !== this.nextId && !allowIdChange) {
                    await this.store();
                }
                this.txn = null;
                this.thingStore = this.userStore = null;
            });
        }
    }
    async addExtension(ext) {
        if (!this.db().objectStoreNames.contains(this.extensionsName)) {
            await new Promise((succeed, fail) => {
                const req = storage.upgrade(succeed);
                req.onerror = fail;
                req.onupgradeneeded = () => {
                    const store = req.transaction.db.createObjectStore(this.extensionsName, { autoIncrement: true });
                    store.createIndex(extensionNameIndex, 'name', { unique: false });
                    store.createIndex(extensionHashIndex, 'hash', { unique: true });
                };
            });
        }
        const txn = this.db().transaction([this.extensionsName], 'readwrite');
        const key = await txn.objectStore(this.extensionsName).put(ext, ext.id);
        return promiseFor(txn).then(() => key);
    }
    async removeExtension(id) {
        if (!this.db().objectStoreNames.contains(this.extensionsName))
            return [];
        const txn = this.db().transaction([this.extensionsName], 'readwrite');
        txn.objectStore(this.extensionsName).delete(id);
        return promiseFor(txn);
    }
    async getExtensions() {
        if (!this.db().objectStoreNames.contains(this.extensionsName))
            return [];
        const txn = this.db().transaction([this.extensionsName], 'readwrite');
        const extensionStore = txn.objectStore(this.extensionsName);
        return new Promise((succeed, fail) => {
            const result = [];
            const req = extensionStore.openCursor();
            req.onerror = fail;
            req.onsuccess = evt => {
                const cursor = evt.target.result;
                if (cursor) {
                    const ext = new Extension(cursor.value);
                    ext.id = cursor.key;
                    result.push(ext);
                    cursor.continue();
                }
                else {
                    succeed(result);
                }
            };
        });
    }
    async evalExtension(ext) {
        try {
            // tslint:disable-next-line:no-eval
            const func = eval(ext.text);
            if (func instanceof Function) {
                func(this, app);
            }
            else if (func instanceof Promise) {
                return func.then(f => {
                    if (f instanceof Function) {
                        f(this, app);
                    }
                    else {
                        throw new Error('Extension should be a function or Promise<Function> but it is not');
                    }
                });
            }
            else {
                throw new Error('Extension should be a function or Promise<Function> but it is not');
            }
        }
        catch (err) {
            alert(`Error running extension ${ext.name} (see console for details): ${err.message}`);
            console.error(err);
        }
    }
    store() {
        return promiseFor(this.thingStore.put(this.spec()));
    }
    processTransaction(func) {
        const result = func(this.thingStore, this.userStore, this.txn);
        return result instanceof Promise ? result : Promise.resolve(result);
    }
    getUser(name) {
        return this.doTransaction(async (store, users, txn) => await promiseFor(users.get(name)));
    }
    getUserForThing(ti) {
        return this.doTransaction(async (store, users, txn) => {
            return promiseFor(users.index(userThingIndex).get(idFor(ti)));
        });
    }
    deleteUser(name) {
        return this.doTransaction(async (store, users, txn) => {
            return new Promise((succeed, fail) => {
                const req = users.openCursor(name);
                req.onsuccess = evt => {
                    const cursor = evt.target.result;
                    if (cursor) {
                        const dreq = cursor.delete();
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
        const userList = [];
        return new Promise((succeed, fail) => {
            return this.doTransaction(async (store, users, txn) => {
                const req = users.openCursor();
                req.onsuccess = evt => {
                    const cursor = evt.target.result;
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
                const name = randomName('user');
                if (!await this.getUser(name)) {
                    return name;
                }
            }
        });
    }
    async createRandomUser() {
        const name = await this.randomUserName();
        return this.createUser(name, randomName('password'), false);
    }
    createUser(name, password, admin) {
        return this.doTransaction(async (store, users, txn) => {
            const user = { name, password, admin };
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
    async replaceUsers(newUsers) {
        await this.doTransaction(async (store, users, txn) => deleteAll(users));
        return this.doTransaction(async (store, users, txn) => Promise.all(newUsers.map(u => this.putUser(u))));
    }
    async replaceExtensions(newExtensions) {
        if (!this.db().objectStoreNames.contains(this.extensionsName)) {
            await new Promise((succeed, fail) => {
                const req = storage.upgrade(succeed);
                req.onerror = fail;
                req.onupgradeneeded = () => {
                    const store = req.transaction.db.createObjectStore(this.extensionsName, { autoIncrement: true });
                    store.createIndex(extensionNameIndex, 'name', { unique: false });
                    store.createIndex(extensionHashIndex, 'hash', { unique: true });
                };
            });
        }
        const txn = this.db().transaction([this.extensionsName], 'readwrite');
        const extensions = txn.objectStore(this.extensionsName);
        await deleteAll(extensions);
        for (const ext of newExtensions) {
            extensions.put(ext, ext.id);
        }
        return promiseFor(txn);
    }
    async replaceThings(newThings) {
        let info;
        await this.doTransaction(async (store, users, txn) => {
            const index = newThings.findIndex(t => t.id === 'info');
            info = newThings[index];
            newThings.splice(index, 1);
            return deleteAll(store);
        });
        return this.doTransaction(async (store, users, txn) => {
            await this.useInfo(info);
            return Promise.all(newThings.map(t => promiseFor(this.thingStore.put(t))));
        });
    }
    async getThing(tip) {
        let id;
        if (typeof tip === 'number') {
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
        const cached = this.thingCache.get(id);
        if (cached) {
            return Promise.resolve(cached);
        }
        return this.doTransaction(async (store) => await this.cacheThingFor(await promiseFor(store.get(id))));
    }
    authenticate(name, passwd, noauthentication = false) {
        return this.doTransaction(async (store, users, txn) => {
            let user = await promiseFor(users.get(name));
            if (noauthentication && !user) { // auto-create a user
                user = { name, password: null };
                await promiseFor(users.put(user));
            }
            else if (!user || user.password !== passwd) {
                throw new Error('Bad user or password');
            }
            if (!user.thing) {
                const thing = await this.createThing(name);
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
    async createThing(name, description) {
        const t = new Thing(this.nextId++, name, description);
        t.world = this;
        t._location = this.limbo;
        if (this.thingProto)
            t.setPrototype(this.thingProto);
        this.thingCache.set(t.id, t);
        await this.doTransaction(async () => {
            return await this.putThing(t);
        });
        return t;
    }
    async cacheThingFor(thingSpec) {
        const thing = new Thing(null, '');
        thing.world = this;
        await thing.useSpec(thingSpec);
        this.thingCache.set(thing.id, thing);
        return thing;
    }
    async cacheThings(specs) {
        for (let i = 0; i < specs.length; i++) {
            const thing = this.thingCache.get(specs[i].id);
            specs[i] = thing || await this.cacheThingFor(specs[i]);
        }
        return specs;
    }
    getContents(thing) {
        const id = typeof thing === 'number' ? thing : thing.id;
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
                const prototype = await thing.getPrototype();
                await this.getAncestors(prototype, ancestors);
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
        const newWorld = await this.storage.openWorld(newName);
        const txn = this.db().transaction([this.storeName, newWorld.storeName, this.users, newWorld.users], 'readwrite');
        const newThings = txn.objectStore(newWorld.storeName);
        await copyAll(txn.objectStore(this.users), txn.objectStore(newWorld.users));
        await copyAll(txn.objectStore(this.storeName), newThings);
        const newInfo = await promiseFor(newThings.get('info'));
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
    closeWorld(name) {
        this.openWorlds.delete(name);
    }
    async openWorld(name = '') {
        if (this.openWorlds.has(name)) {
            return this.openWorlds.get(name);
        }
        if (!name) {
            name = this.randomWorldName();
        }
        const world = new World(name, this);
        if (!this.hasWorld(name)) {
            this.worlds.push(name);
            await this.store();
            await world.initDb();
        }
        else {
            await world.loadInfo();
        }
        await world.initStdPrototypes();
        this.openWorlds.set(name, world);
        for (const extension of await world.getExtensions()) {
            await world.evalExtension(extension);
        }
        return world;
    }
    randomWorldName() {
        for (;;) {
            const name = randomName('mud');
            if (!this.hasWorld(name)) {
                return name;
            }
        }
    }
    store() {
        const txn = this.db.transaction(centralDbName, 'readwrite');
        const store = txn.objectStore(centralDbName);
        return promiseFor(store.put(this.spec(), infoKey));
    }
    spec() {
        return { worlds: this.worlds };
    }
    upgrade(then) {
        let version = this.db.version;
        this.db.close();
        const req = indexedDB.open(centralDbName, ++version);
        req.onsuccess = evt => {
            this.db = req.result;
            then(evt);
        };
        return req;
    }
    deleteWorld(name) {
        return new Promise((succeed, fail) => {
            const index = this.worlds.indexOf(name);
            if (index !== -1) {
                const req = this.upgrade(async () => {
                    await this.store();
                    return succeed();
                });
                req.onupgradeneeded = () => {
                    const txn = req.transaction;
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
        return new Promise(async (succeed, fail) => {
            const index = this.worlds.indexOf(name);
            if (newName && name !== newName && index !== -1 && !this.hasWorld(newName)) {
                const world = await this.openWorld(name);
                const req = this.upgrade(async () => {
                    world.setName(newName);
                    await world.doTransaction(() => world.store());
                    console.log('STORING MUD INFO');
                    await this.store();
                    succeed();
                });
                req.onupgradeneeded = async () => {
                    const txn = req.transaction;
                    this.db = req.result;
                    this.worlds[index] = newName;
                    this.openWorlds.set(newName, world);
                    this.openWorlds.delete(name);
                    txn.objectStore(mudDbName(name)).name = mudDbName(newName);
                    txn.objectStore(userDbName(name)).name = userDbName(newName);
                };
                req.onerror = fail;
            }
            else if (name === newName) {
                succeed();
            }
            else if (index === -1) {
                fail(new Error('There is no world named ' + name));
            }
            else {
                fail(new Error('There is already a world named ' + newName));
            }
        });
    }
    async strippedBlobForWorld(name) {
        const index = this.worlds.indexOf(name);
        if (index === -1) {
            return Promise.reject(new Error('No world found named ' + name));
        }
        return new Promise(async (succeed, fail) => {
            const dbs = [mudDbName(name)];
            if (this.db.objectStoreNames.contains(extensionDbName(name))) {
                dbs.push(extensionDbName(name));
            }
            const txn = this.db.transaction(dbs);
            const result = {
                objects: await jsonObjectsForDb(txn.objectStore(mudDbName(name))),
            };
            if (dbs.length === 2) {
                result.extensions = await jsonObjectsForDb(txn.objectStore(extensionDbName(name)));
            }
            succeed(blobForYamlObject(result));
        });
    }
    fullBlobForWorld(name) {
        const index = this.worlds.indexOf(name);
        if (index === -1) {
            return Promise.reject(new Error('No world found named ' + name));
        }
        return new Promise(async (succeed, fail) => {
            const dbs = [mudDbName(name), userDbName(name)];
            if (this.db.objectStoreNames.contains(extensionDbName(name))) {
                dbs.push(extensionDbName(name));
            }
            const txn = this.db.transaction(dbs);
            const result = {
                users: await jsonObjectsForDb(txn.objectStore(userDbName(name))),
                objects: await jsonObjectsForDb(txn.objectStore(mudDbName(name))),
            };
            if (dbs.length === 3) {
                result.extensions = await jsonObjectsForDb(txn.objectStore(extensionDbName(name)));
            }
            succeed(blobForYamlObject(result));
        });
    }
    uploadWorld(world) {
        return world.users ? this.uploadFullWorld(world)
            : this.uploadStrippedWorld(world);
    }
    async uploadFullWorld(worldAndUsers) {
        const users = worldAndUsers.users;
        const objects = worldAndUsers.objects;
        const info = objects.find(i => i.id === 'info');
        const world = await this.openWorld(info.name);
        return world.doTransaction(async (thingStore, userStore, txn) => {
            await this.uploadStrippedWorld(objects, world);
            await world.replaceUsers(users);
        });
    }
    async uploadStrippedWorld(data, world = null) {
        if (world) {
            return world.replaceThings(data.objects);
        }
        else {
            const info = data.objects.find(i => i.id === 'info');
            world = await this.openWorld(info.name);
            await world.replaceThings(data.objects);
            if (data.extensions)
                return world.replaceExtensions(data.extensions);
        }
    }
}
export function blobForYamlObject(object) {
    return new Blob([jsyaml.dump(object, { flowLevel: 3 })], { type: 'text/yaml' });
}
export function blobForJsonObjects(objects) {
    return new Blob(objects, { type: 'application/json' });
}
export async function blobForDb(objectStore) {
    return blobForJsonObjects(await jsonObjectsForDb(objectStore));
}
export function jsonObjectsForDb(objectStore, records = []) {
    return new Promise((succeed, fail) => {
        const req = objectStore.openCursor();
        const first = true;
        req.onsuccess = evt => {
            const cursor = evt.target.result;
            if (cursor) {
                records.push(cursor.value);
                cursor.continue();
            }
            else {
                succeed(records);
            }
        };
        req.onerror = evt => {
            console.log('failure: ', evt);
            fail(evt);
        };
    });
}
function idFor(t) {
    return t instanceof Thing ? t._id : t;
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
        const req = indexedDB.open(centralDbName);
        req.onupgradeneeded = () => {
            const db = req.result;
            const txn = req.transaction;
            storage = new MudStorage(db);
            const objectStore = db.createObjectStore(centralDbName);
            const store = txn.objectStore(centralDbName);
            store.put(storage.spec(), infoKey);
        };
        req.onsuccess = async (evt) => {
            const db = req.result;
            const txn = db.transaction(centralDbName, 'readwrite');
            const store = txn.objectStore(centralDbName);
            if (!storage) {
                storage = new MudStorage(db);
            }
            const result = await promiseFor(store.get(infoKey));
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
    return array.indexOf(item) !== -1;
}
function mudDbName(name) {
    return 'world ' + name;
}
function userDbName(name) {
    return 'world ' + name + usersSuffix;
}
function extensionDbName(name) {
    return 'world ' + name + extensionsSuffix;
}
export function randomName(prefix) {
    return prefix + Math.round(Math.random() * 10000000);
}
function deleteAll(store) {
    return new Promise((succeed, fail) => {
        const req = store.openCursor();
        req.onerror = fail;
        req.onsuccess = evt => {
            const cursor = evt.target.result;
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
        const req = srcStore.openCursor();
        req.onerror = fail;
        req.onsuccess = async (evt) => {
            const cursor = evt.target.result;
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
export function findSimpleName(str) {
    let words;
    let name;
    let article;
    let foundPrep = false;
    let tmp = str;
    for (;;) {
        const prepMatch = tmp.match(/^(.*?)\b(of|on|about|in|from)\b/);
        if (prepMatch) {
            if (prepMatch[1].trim()) {
                // if it contains a preposition, discard from the first preposition on
                // the king of sorrows
                // the king in absentia
                words = str.substring(0, tmp.length - prepMatch[1].length).trim().split(/\s+/);
                foundPrep = true;
                break;
            }
            else {
                tmp = tmp.substring(prepMatch[1].length);
                continue;
            }
        }
        words = str.split(/\s+/);
        break;
    }
    if (words.length > 1 && words[0].match(/\b(the|a|an)\b/)) { // scrape articles
        article = words[0];
        words = words.slice(1);
    }
    // choose the last word
    name = words[words.length - 1].toLowerCase();
    return [article, name];
}
export function escape(text) {
    return typeof text === 'string' ? text.replace(/</g, '&lt;') : text;
}
export function init(appObj) {
    app = appObj;
}
export function toHex(arraylike) {
    let result = '';
    for (const i of arraylike) {
        // tslint:disable-next-line:no-bitwise
        const val = (i & 0xFF).toString(16);
        if (val.length === 1)
            result += '0';
        result += val;
    }
    return result;
}
export function fromHex(hex) {
    const output = new Int8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        output[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
    }
    return output;
}
//# sourceMappingURL=model.js.map