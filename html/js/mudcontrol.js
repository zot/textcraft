import { MudState, RoleState, PeerState, mudTracker, roleTracker, peerTracker, } from './base.js';
import { findSimpleName, escape, } from './model.js';
import * as mudproto from './mudproto.js';
let app;
let connection;
// probably should move this into World
const connectionMap = new Map();
export let activeWorld;
const reservedProperties = new Set([
    '_id',
    '_prototype',
    '_location',
    '_contents',
    '_links',
    '_linkOwner',
    '_otherLink',
    '__proto__',
]);
const addableProperties = new Set([
    '_keys',
]);
const properties = [
    'prototype',
    'article',
    'name',
    'count',
    'location',
    'description',
    'linkOwner',
    'otherLink',
];
const lowercaseProperties = properties.map(p => p.toLowerCase());
const setHelp = ['thing property value', `Set one of these properties on a thing:
  prototype   -- see the @info command
  article     -- the article for a thing's name
  name        -- the thing's fullName (the name will be set to the first word)
  count       -- how many there are of the thing (defaults to 1)
  location    -- move the thing to another location
  linkowner   -- set the thing's linkOwner
  otherlink   -- set the thing's otherLink
  description -- the thing's description, you can use format words in a description (see format words).
                 If you capitalize a format word, the substitution will be capitalized.

  Here are the fields you can set:
    name            -- simple one-word name for this object, for commands to find it
    fullName        -- the formatted name
    article         -- precedes the formatted name when this is displayed
    description     -- shown for look/examine commands
    examineFormat   -- describes an item's contents and links
    contentsFormat  -- describes an item in contents
    linkFormat      -- decribes how this item links to its other link
    linkMoveFormat  -- shown to someone when they move through a link
    linkEnterFormat -- shown to occupants when someone enters through the link
    linkExitFormat  -- shown to occupants when someone leaves through the link
    location        -- if this thing has a location, it is in its location's contents
    linkOwner       -- the owner of this link (if this is a link)
    otherLink       -- the other link (if this is a link)
    keys[]          -- locks that this thing allows opening
    locked          -- whether this link is locked
    lockPassFormat  -- message to show when someone passes through a locked link
    lockFailFormat  -- message to show when someone fails to pass through a locked link
    closed          -- whether this object propagates descriptons to its location
    template        -- whether to copy this object during a move command
`
];
class Command {
    constructor({ help, admin, alt }) {
        this.help = help;
        this.admin = admin;
        this.alt = alt;
    }
}
const commands = new Map([
    ['help', new Command({ help: ['', 'Show this message'] })],
    ['login', new Command({ help: ['user password', 'Login to the mud'] })],
    ['look', new Command({ help: ['', `See a description of your current location`,
                'thing', 'See a description of a thing'] })],
    ['go', new Command({ help: ['location', `move to another location (may be a direction)`] })],
    ['i', new Command({ help: [''], alt: 'inventory' })],
    ['invent', new Command({ help: [''], alt: 'inventory' })],
    ['inventory', new Command({ help: ['', `list what you are carrying`] })],
    ['say', new Command({ help: ['words...', `Say something`] })],
    ['whisper', new Command({ help: ['thing words...', `Say something to thing`] })],
    ['act', new Command({ help: ['words...', `Do something`] })],
    ['gesture', new Command({ help: ['thing words...', `Do something towards thing`] })],
    ['get', new Command({ help: ['thing', `grab a thing`,
                'thing [from] location', `grab a thing from a location`] })],
    ['drop', new Command({ help: ['thing', `drop something you are carrying`] })],
    ['@dump', new Command({ help: ['thing', 'See properties of a thing'] })],
    ['@move', new Command({ help: ['thing location', 'Move a thing'] })],
    ['@admin', new Command({ help: ['thing boolean', 'Change a thing\'s admin privileges'] })],
    ['@create', new Command({ help: ['proto name [description words...]', 'Create a thing'] })],
    ['@find', new Command({ help: ['thing', 'Find a thing',
                'thing location', 'Find a thing from a location',] })],
    ['@link', new Command({ help: ['loc1 link1 link2 loc2', 'create links between two things'] })],
    ['@info', new Command({ help: ['', 'List important information'] })],
    ['@add', new Command({ help: ['thing property thing2', `Add thing2 to the list in property`], admin: true })],
    ['@remove', new Command({ help: ['thing property thing2', `Remove thing2 from the list in property`], admin: true })],
    ['@setNum', new Command({ help: ['thing property number'], admin: true, alt: '@set' })],
    ['@setBigint', new Command({ help: ['thing property bigint'], admin: true, alt: '@set' })],
    ['@setBool', new Command({ help: ['thing property boolean'], admin: true, alt: '@set' })],
    ['@set', new Command({ help: setHelp, admin: true })],
    ['@del', new Command({ help: ['thing property', `Delete a properties from a thing so it will inherit from its prototype`] })],
]);
export function init(appObj) {
    app = appObj;
    for (const cmdName of commands.keys()) {
        const command = commands.get(cmdName);
        command.minArgs = 1000;
        command.name = cmdName;
        if (command.alt) {
            const alt = commands.get(command.alt);
            if (!alt.alts)
                alt.alts = [];
            commands.get(command.alt).alts.push(command);
        }
        if (cmdName[0] === '@') {
            command.admin = true;
            command.method = 'at' + capitalize(cmdName.substring(1));
        }
        else {
            command.method = command.name;
        }
        for (let i = 0; i < command.help.length; i += 2) {
            command.minArgs = Math.min(command.minArgs, command.help[i].split(/ +/).length);
        }
    }
}
export class Descripton {
    constructor(visitFunc, visitLinks = false) {
        this.visitFunc = visitFunc;
        this.visitLinks = visitLinks;
        this.visited = new Set();
    }
    /**
     * Propagate to a thing and its contents
     * If the thing is open, also propagate to its location
     * If this.visitLinks is true, also propagate through links
     */
    async propagate(thing) {
        if (this.done || !thing || this.visited.has(thing))
            return;
        this.visited.add(thing);
        this.visitFunc(thing, this);
        for (const item of await thing.getContents()) {
            await this.propagate(item);
        }
        if (this.visitLinks) {
            for (const item of await thing.getLinks()) {
                const otherLink = await thing.getOtherLink();
                const otherThing = otherLink && await otherLink.getLinkOwner();
                await this.propagate(otherLink);
                await this.propagate(otherThing);
            }
        }
        if (!thing._closed || this.ignoreClosed)
            return this.propagate(await thing.getLocation());
    }
}
export class Mud {
    move(thing, location) {
        thing.setLocation(location);
    }
    link(thing, link, otherLink) {
        link.setLinkOwner(thing);
        if (otherLink) {
            link.setOtherLink(otherLink);
        }
    }
}
export class MudConnection {
    constructor(world, outputHandler) {
        this.world = world;
        this.outputHandler = outputHandler;
        this.created = [];
    }
    async close() {
        this.thing?.setLocation(this.thing.world.limbo);
        connectionMap.delete(this.thing);
        this.world = null;
        this.user = null;
        this.admin = false;
        this.thing = null;
        this.outputHandler = null;
        this.created = null;
        if (this === connection) {
            mudTracker.setValue(MudState.NotPlaying);
            roleTracker.setValue(RoleState.None);
        }
    }
    error(text) {
        this.output('<div class="error">' + text + '</div>');
        this.failed = true;
    }
    errorNoThing(thing) {
        this.error(`You don't see any ${thing} here`);
    }
    output(text) {
        this.outputHandler(text.match(/^</) ? text : `<div>${text}</div>`);
        this.failed = false;
    }
    start() {
        mudTracker.setValue(MudState.Playing);
        this.outputHandler(`Welcome to ${this.world.name}, use the "login" command to log in.
<p>
<p>
<p>Help lists commands...
<p>
<p>Click on old commands to reuse them`);
    }
    formatMe(tip, str, ...args) {
        const ctx = formatContexts(str);
        return this.basicFormat(tip, ctx.me || ctx.others, args);
    }
    // same as formatOthers(...)
    format(tip, str, ...args) {
        return this.basicFormat(tip, formatContexts(str).others, args);
    }
    formatOthers(tip, str, ...args) {
        return this.basicFormat(tip, formatContexts(str).others, args);
    }
    formatName(thing) {
        return `${thing.formatName()}${this.admin ? '(%' + thing._id + ')' : ''}`;
    }
    async basicFormat(tip, str, args) {
        if (!str)
            return str;
        const thing = await this.world.getThing(tip);
        const parts = str.split(/( *\$\w*)/);
        let result = '';
        for (const part of parts) {
            const match = part.match(/^( *)\$(.*)$/);
            if (match) {
                const [_, space, format] = match;
                const argMatch = format.toLowerCase().match(/arg([0-9]*)/);
                result += space;
                if (argMatch) {
                    const arg = args[argMatch[1] ? Number(argMatch[1]) - 1 : 0];
                    result += capitalize(this.formatName(arg), format);
                    continue;
                }
                switch (format.toLowerCase()) {
                    case 'this': {
                        let name;
                        if (thing === this.thing) {
                            name = 'you';
                        }
                        else {
                            name = this.formatName(thing);
                        }
                        result += capitalize(name, format);
                        continue;
                    }
                    case 'name': {
                        result += thing.name;
                        continue;
                    }
                    case 'is': {
                        result += thing && thing === this.thing ? 'are' : 'is';
                        continue;
                    }
                    case 's': {
                        if (!thing || thing !== this.thing) {
                            result += (result.match(/\sgo$/) ? 'es' : 's');
                        }
                        continue;
                    }
                    case 'location': {
                        result += capitalize((await thing.getLocation()).formatName(), format);
                        continue;
                    }
                    case 'owner': {
                        result += capitalize((await thing.getLinkOwner()).formatName(), format);
                        continue;
                    }
                    case 'link': {
                        const other = await thing.getOtherLink();
                        const dest = await other?.getLinkOwner();
                        if (dest) {
                            result += capitalize(this.formatName(dest), format);
                        }
                        continue;
                    }
                    case 'contents': {
                        const contents = await thing.getContents();
                        if (contents.length) {
                            for (const item of contents) {
                                result += `<br>&nbsp;&nbsp;${await this.format(item, thing.contentsFormat)}`;
                            }
                            result += '<br>';
                        }
                        continue;
                    }
                    case 'links': {
                        const links = await thing.getLinks();
                        if (links.length) {
                            for (const item of links) {
                                result += `<br>&nbsp;&nbsp;${await this.format(item, item.linkFormat)}`;
                            }
                            result += '<br>';
                        }
                        continue;
                    }
                }
            }
            result += part;
        }
        return result;
    }
    async dumpName(tip) {
        const thing = await this.world.getThing(tip);
        return escape(thing ? `%${thing._id} ${this.formatName(thing)}` : 'null');
    }
    description(thing) {
        return this.format(thing, thing.description);
    }
    async examination(thing) {
        const result = await this.description(thing);
        return result + (thing.examineFormat ? `<br>${await this.format(thing, thing.examineFormat)}` : '');
    }
    async describe(thing) {
        this.output(await this.description(thing));
    }
    checkCommand(cmd, cmdProp, thing) {
        return (cmd === thing.name && thing._cmd) || thing[cmdProp];
    }
    async findCommand(words) {
        const cmd = words[0].toLowerCase();
        const cmdProp = `_cmd_${cmd}`;
        let template;
        for (const item of (await this.thing.getContents())) {
            template = this.checkCommand(cmd, cmdProp, item);
            if (template) {
                break;
            }
        }
        if (!template) {
            for (const item of (await this.thing.getLinks())) {
                template = this.checkCommand(cmd, cmdProp, item);
                if (template) {
                    break;
                }
            }
        }
        if (!template) {
            const loc = await this.thing.getLocation();
            template = this.checkCommand(cmd, cmdProp, loc);
            if (!template) {
                for (const item of (await loc.getLinks())) {
                    template = this.checkCommand(cmd, cmdProp, item);
                    if (template) {
                        break;
                    }
                }
            }
        }
        if (template) {
            const parts = template.split(/( *\$\w*)/);
            let newCmd = '';
            for (const part of parts) {
                const match = part.match(/^( *)\$([0-9]+)$/);
                if (match) {
                    const [_, space, format] = match;
                    newCmd += space;
                    newCmd += words[Number(format)];
                }
                else {
                    newCmd += part;
                }
            }
            return newCmd.split(/\s+/);
        }
    }
    async runCommands(lines) {
        for (const line of lines) {
            await this.command(line.join(' '), true);
            if (this.failed)
                break;
        }
    }
    async command(line, suppressFind = false) {
        if (line[0] === '"' || line[0] === "'") {
            line = `say ${line.substring(1)}`;
        }
        else if (line[0] === ':') {
            line = `act ${line.substring(1)}`;
        }
        let words = line.split(/\s+/);
        let commandName = words[0].toLowerCase();
        this.output('<div class="input">&gt; <span class="input-text">' + line + '</span></div>');
        if (!commands.has(commandName) && !suppressFind) {
            const newWords = (await this.findCommand(words));
            if (Array.isArray(newWords[0]))
                return this.runCommands(newWords);
            if (newWords && commands.has(newWords[0])) {
                words = newWords;
                commandName = words[0].toLowerCase();
            }
        }
        if (this.thing ? commands.has(commandName) : commandName === 'login' || commandName === 'help') {
            let command = commands.get(commandName);
            if (command.alt)
                command = commands.get(command.alt);
            if (command?.admin && !this.admin) {
                return this.error('Unknown command: ' + words[0]);
            }
            // execute command inside a transaction so it will automatically store any dirty objects
            this.world.doTransaction(() => this[command.method]({ command, line }, ...words.slice(1)))
                .catch(err => this.error(err.message));
        }
        else {
            this.output('Unknown command: ' + words[0]);
        }
    }
    async find(name, start = this.thing, errTag = '') {
        let result;
        if (!name)
            return null;
        name = name.trim().toLowerCase();
        if (start[0] !== '%' || this.admin) {
            if (name === 'out') {
                const location = await this.thing.getLocation();
                result = location && await location.getLocation();
                if (!result || result.id === this.world.limbo) {
                    throw new Error('You are not in a container');
                }
            }
            else {
                result = name === 'me' ? this.thing
                    : name === 'here' ? await this.thing.getLocation()
                        : name === '%limbo' ? await this.world.getThing(this.world.limbo)
                            : name === '%lobby' ? await this.world.getThing(this.world.lobby)
                                : name === '%protos' ? await this.world.getThing(this.world.hallOfPrototypes)
                                    : name.match(/^%proto:/) ? await (await this.world.getThing(this.world.hallOfPrototypes)).find(name.replace(/^%proto:/, ''))
                                        : name.match(/%-[0-9]+/) ? this.created[this.created.length - Number(name.substring(2))]
                                            : name.match(/%[0-9]+/) ? await this.world.getThing(Number(name.substring(1)))
                                                : await start.find(name, this.thing._location === this.world.limbo ? new Set() : new Set([await this.world.getThing(this.world.limbo)]));
            }
        }
        if (!result && errTag) {
            throw new Error(`Could not find ${errTag}: ${name}`);
        }
        return result;
    }
    async dumpThingNames(things) {
        const items = [];
        for (const item of things) {
            items.push(await this.dumpName(item));
        }
        return items.join(', ');
    }
    async thingProps(thingStr, property, value, cmd) {
        const thing = await this.find(thingStr);
        const propMap = new Map();
        const lowerProp = property.toLowerCase();
        let realProp;
        if (!thing) {
            this.error('Could not find thing ' + thingStr);
            return [];
        }
        else if (lowerProp === 'id') {
            this.error('Cannot change id!');
            return [];
        }
        else if (lowerProp === '_proto__') {
            this.error('Cannot change __proto__!');
            return [];
        }
        for (const key in thing) {
            if (key !== '_id' && key[0] === '_') {
                propMap.set(key.substring(1).toLowerCase(), key);
            }
        }
        if (propMap.has(lowerProp)) {
            realProp = propMap.get(lowerProp);
            const curVal = thing[realProp];
            switch (typeof curVal) {
                case 'number':
                    value = Number(value);
                    break;
                case 'boolean':
                    value = value.toLowerCase() in { t: true, true: true };
                    break;
                case 'bigint':
                    value = BigInt(value);
                    break;
                default:
                    value = dropArgs(3, cmd);
                    break;
            }
        }
        else {
            realProp = '_' + property;
            value = dropArgs(3, cmd);
        }
        return [thing, lowerProp, realProp, value, propMap];
    }
    async doLogin(user, password, noauthentication = false) {
        try {
            const [thing, admin] = await this.world.authenticate(user, password, noauthentication);
            const lobby = await this.world.getThing(this.world.lobby);
            this.user = user;
            this.thing = thing;
            this.admin = admin;
            connectionMap.set(this.thing, this);
            this.output('Connected.');
            thing.setLocation(lobby);
            await this.commandDescripton('has arrived');
            // tslint:disable-next-line:no-floating-promises
            this.look(null, null);
        }
        catch (err) {
            this.error(err.message);
        }
    }
    async commandDescripton(action, except = this.thing, startAt, prefix = true) {
        const text = prefix ? `${this.formatName(this.thing)} ${action}` : action;
        const desc = new Descripton(thing => {
            connectionMap.get(thing)?.output(text);
        });
        if (!startAt)
            startAt = await this.thing.getLocation();
        if (except)
            desc.visited.add(except);
        return desc.propagate(startAt);
    }
    async hasKey(lock, start) {
        if (start._keys.indexOf(lock._id) !== -1) {
            return true;
        }
        for (const item of await start.getContents()) {
            if (item._keys.indexOf(lock._id) !== -1) {
                return true;
            }
        }
        return false;
    }
    // COMMAND
    login(cmdInfo, user, password) {
        return this.doLogin(user, password);
    }
    // COMMAND
    async look(cmdInfo, target) {
        if (target) {
            const thing = await this.find(target, this.thing, 'object');
            if (!thing) {
                this.errorNoThing(target);
                return this.commandDescripton(`looks for a ${target} but doesn't see any`);
            }
            else {
                this.output(await this.description(thing));
                if (thing === this.thing) {
                    return this.commandDescripton(`looks at themself`);
                }
                else {
                    return this.commandDescripton(`looks at ${await this.description(thing)}`);
                }
            }
        }
        else {
            this.output(await this.examination(await this.thing.getLocation()));
            return this.commandDescripton(`looks around`);
        }
    }
    // COMMAND
    async go(cmdInfo, directionStr) {
        const oldLoc = await this.thing.getLocation();
        const direction = await this.find(directionStr, this.thing, 'direction');
        const link = direction._otherLink && await direction.getOtherLink();
        let location;
        if (link) {
            location = link && await link.getLinkOwner();
            if (!location) {
                return this.error(`${directionStr} does not lead anywhere`);
            }
        }
        if (direction._locked) {
            if (!await this.hasKey(direction, this.thing)) {
                return this.error(await this.format(direction, direction._lockFailFormat, this.thing, location));
            }
        }
        await this.thing.setLocation(location);
        if (direction._locked) {
            this.output(await this.formatMe(direction, direction._lockPassFormat, this.thing, location));
            await this.commandDescripton(await this.formatOthers(direction, direction._lockPassFormat, this.thing, oldLoc), this.thing, oldLoc);
        }
        else {
            this.output(await this.formatMe(direction, direction._linkMoveFormat, this.thing, oldLoc, location));
            await this.commandDescripton(await this.format(direction, direction._linkExitFormat, this.thing, oldLoc), this.thing, oldLoc);
        }
        await this.commandDescripton(await this.format(link, link._linkEnterFormat, this.thing, location), this.thing, location);
        await this.look(cmdInfo);
    }
    // COMMAND
    async inventory(cmdInfo) {
        this.output(`<pre>You are carrying\n${indent(3, (await this.thing.getContents()).map(item => this.formatName(item)).join('\n'))}</pre>`);
    }
    // COMMAND
    async get(cmdInfo, thingStr, ...args) {
        const location = await this.thing.getLocation();
        let loc = location;
        if (args.length) {
            const [_, name] = findSimpleName(args.join(' '));
            loc = await this.find(name, loc);
            if (!loc)
                return this.errorNoThing(name);
        }
        const thing = await this.find(thingStr, loc);
        if (!thing)
            return this.errorNoThing(thingStr);
        if (thing === this.thing)
            return this.error(`You just don't get yourself. Some people are that way.`);
        if (thing === location)
            return this.error(`You just don't get this place. Some people are that way.`);
        await thing.setLocation(this.thing);
        this.output(`You pick up ${thing.formatName()}`);
        return this.commandDescripton(`picks up ${this.formatName(thing)}`);
    }
    // COMMAND
    async drop(cmdInfo, thingStr) {
        const thing = await this.find(thingStr, this.thing);
        const loc = await this.thing.getLocation();
        if (!thing)
            return this.errorNoThing(thingStr);
        if (thing._location !== this.thing._id)
            return this.error(`You aren't holding ${thingStr}`);
        await thing.setLocation(loc);
        this.output(`You drop ${this.formatName(thing)}`);
        return this.commandDescripton(`drops ${this.formatName(thing)}`);
    }
    // COMMAND
    async say(cmdInfo, ...words) {
        const text = escape(dropArgs(1, cmdInfo));
        this.output(`You say, "${text}"`);
        return this.commandDescripton(`says, "${text}"`);
    }
    // COMMAND
    async whisper(cmdInfo, thingStr, ...words) {
        const thing = await this.find(thingStr);
        const text = escape(dropArgs(2, cmdInfo));
        if (!thing)
            return this.errorNoThing(thingStr);
        connectionMap.get(thing)?.output(`${this.formantName(this.thing)} whispers, "${text}", to you`);
        this.output(`You whisper, "${text}", to ${this.formatName(thing)}`);
    }
    // COMMAND
    async act(cmdInfo, ...words) {
        const text = escape(dropArgs(1, cmdInfo));
        return this.commandDescripton(`<i>${this.formatName(this.thing)} ${text}</i>`, null, null, false);
    }
    // COMMAND
    async gesture(cmdInfo, thingStr, ...words) {
        const thing = await this.find(thingStr);
        const text = escape(dropArgs(2, cmdInfo));
        if (!thing)
            return this.errorNoThing(thingStr);
        connectionMap.get(thing)?.output(`<i>${this.formatName(this.thing)} ${text} at you</i>`);
        await this.commandDescripton(`<i>${this.formatName(this.thing)} ${text} at ${this.formatName(thing)}</i>`, thing, null, false);
    }
    // COMMAND
    async atCreate(cmdInfo, protoStr, name) {
        const proto = await this.find(protoStr, await this.world.getThing(this.world.hallOfPrototypes));
        if (!proto) {
            const hall = await this.world.getThing(this.world.hallOfPrototypes);
            const protos = [];
            for (const aproto of await hall.getContents()) {
                protos.push(`%${aproto._id} %proto:${aproto.name}`);
            }
            this.error(`<pre>Could not find prototype ${protoStr}
Prototypes:
  ${protos.join('\n  ')}`);
        }
        else {
            const fullname = dropArgs(2, cmdInfo);
            const thing = await this.world.createThing(fullname);
            thing.setPrototype(proto);
            this.created.push(thing);
            if (this.created.length > 100)
                this.created = this.created.slice(this.created.length - 50);
            this.output(`Created ${await this.dumpName(thing)}`);
        }
    }
    // COMMAND
    async getPrototype(name) {
        return this.find(name, await this.world.getThing(this.world.hallOfPrototypes), `${name} prototype`);
    }
    // COMMAND
    async atLink(cmdInfo, loc1Str, exit1Str, exit2Str, loc2Str) {
        checkArgs(cmdInfo, arguments);
        const loc1 = await this.find(loc1Str, this.thing, 'location1');
        const loc2 = await this.find(loc2Str, this.thing, 'location2');
        const linkProto = await this.getPrototype('link');
        const exit1 = await this.world.createThing(exit1Str);
        const exit2 = await this.world.createThing(exit2Str);
        exit1.name = exit1Str;
        exit1.setPrototype(linkProto);
        exit1.setLinkOwner(loc1);
        exit1.setOtherLink(exit2);
        exit2.name = exit2Str;
        exit2.setPrototype(linkProto);
        exit2.setLinkOwner(loc2);
        exit2.setOtherLink(exit1);
        this.output(`Linked ${await this.dumpName(loc1)}->${await this.dumpName(exit1)}--${await this.dumpName(exit2)}<-${await this.dumpName(loc2)}`);
    }
    // COMMAND
    async atDump(cmdInfo, thingStr) {
        checkArgs(cmdInfo, arguments);
        const thing = await this.find(thingStr);
        if (!thing)
            return this.error('could not find ' + thingStr);
        const spec = thing.spec();
        const myKeys = new Set(Object.keys(thing).filter(k => !reservedProperties.has(k) && k[0] === '_'));
        const allKeys = [];
        let result = `<pre>${await this.dumpName(thing)}
   prototype: ${thing._prototype ? await this.dumpName(await thing.world.getThing(thing._prototype)) : 'none'}
   location:  ${await this.dumpName(thing._location)}
   contents:  ${await this.dumpThingNames(await thing.getContents())}
   links:     ${await this.dumpThingNames(await thing.getLinks())}
   linkOwner: ${await this.dumpName(thing._linkOwner)}
   otherLink: ${await this.dumpName(thing._otherLink)}`;
        for (const prop in thing) {
            if (prop[0] === '_' && !reservedProperties.has(prop)) {
                allKeys.push(prop);
            }
        }
        allKeys.sort();
        for (const prop of allKeys) {
            let propName = prop.substring(1);
            if (!myKeys.has(prop)) {
                propName = `(${propName})`;
            }
            result += `\n   ${propName}: ${escape(JSON.stringify(thing[prop]))}`;
        }
        result += '</pre>';
        this.output(result);
    }
    // COMMAND
    async atMove(cmdInfo, thingStr, locStr) {
        const thing = await this.find(thingStr);
        const loc = await this.find(locStr);
        if (!thing)
            return this.error(`Could not find ${thingStr}`);
        if (!loc)
            return this.error(`Could not find ${locStr}`);
        thing.setLocation(loc);
        this.output(`You moved ${thingStr} to ${locStr}`);
    }
    // COMMAND
    async atAdmin(cmdInfo, thingStr, toggle) {
        checkArgs(cmdInfo, arguments);
        const thing = await this.find(thingStr);
        if (!thing)
            return this.error(`Could not find ${thingStr}`);
        const con = connectionMap.get(thing);
        const boolVal = toggle.toLowerCase() in { t: true, true: true };
        const user = await this.world.getUserForThing(thing);
        if (user.admin !== toggle) {
            user.admin = toggle;
            await this.world.putUser(user);
            if (con)
                con.admin = toggle;
            if (toggle)
                con.output(`${this.formatName(this.thing)} just upgraded you`);
        }
        this.output(`You just ${toggle ? 'upgraded' : 'downgraded'} ${thingStr}`);
    }
    // COMMAND
    async atAdd(cmdInfo, thingStr, property, thing2Str) {
        checkArgs(cmdInfo, arguments);
        const thing = await this.find(thingStr, this.thing, 'thing');
        const thing2 = await this.find(thing2Str, this.thing, 'thing2');
        const prop = '_' + property.toLowerCase();
        if (!addableProperties.has(prop)) {
            return this.error(`${property} is not a list`);
        }
        if (thing[prop].indexOf(thing2._id) === -1) {
            if (!thing.hasOwnProperty(prop))
                thing[prop] = thing[prop].slice();
            thing.markDirty();
            thing[prop].push(thing2._id);
            this.output(`Added ${thing2Str} to ${property}`);
        }
        else {
            this.error(`${thing2Str} is already in ${property}`);
        }
    }
    // COMMAND
    async atRemove(cmdInfo, thingStr, property, thing2Str) {
        checkArgs(cmdInfo, arguments);
        const thing = await this.find(thingStr, this.thing, 'thing');
        const thing2 = await this.find(thing2Str, this.thing, 'thing2');
        const prop = '_' + property.toLowerCase();
        if (!addableProperties.has(prop)) {
            this.error(`${property} is not a list`);
        }
        const index = thing[prop].indexOf(thing2._id);
        if (index !== -1) {
            thing.markDirty();
            thing[prop].splice(index, 1);
            this.output(`Removed ${thing2Str} from ${property}`);
        }
        else {
            this.error(`${thing2Str} is not in ${property}`);
        }
    }
    // COMMAND
    atSetBigInt(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments);
        return this.atSet(cmdInfo, thingStr, property, BigInt(value));
    }
    // COMMAND
    atSetBool(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments);
        return this.atSet(cmdInfo, thingStr, property, Boolean(value));
    }
    // COMMAND
    atSetNum(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments);
        return this.atSet(cmdInfo, thingStr, property, Number(value));
    }
    // COMMAND
    async atSet(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments);
        const [thing, lowerProp, realProp, val, propMap] = await this.thingProps(thingStr, property, value, cmdInfo);
        value = val;
        if (!thing)
            return;
        if (addableProperties.has(realProp))
            return this.error(`Cannot set ${property}`);
        switch (lowerProp) {
            case 'count':
                thing.count = Number(value);
                break;
            case 'fullname': {
                thing.fullName = value;
                break;
            }
            case 'location': {
                const location = await this.find(value);
                if (!location) {
                    this.error('Could not find location ' + value);
                    return;
                }
                await thing.setLocation(location);
                break;
            }
            case 'linkowner':
                const owner = await this.find(value);
                if (!owner) {
                    this.error('Could not find link owner ' + value);
                    return;
                }
                await thing.setLinkOwner(owner);
                break;
            case 'otherlink':
                const other = await this.find(value);
                if (!other) {
                    this.error('Could not find other link ' + value);
                    return;
                }
                await thing.setOtherLink(other);
                break;
            case 'prototype':
                const proto = await this.find(value, await this.world.getThing(this.world.hallOfPrototypes));
                if (!proto) {
                    this.error('Could not find prototype ' + value);
                    return;
                }
                await thing.setPrototype(proto);
                break;
            default:
                thing.markDirty(thing[realProp] = value);
                break;
        }
        this.output(`set ${thingStr} ${property} to ${value}`);
    }
    // COMMAND
    async atDel(cmdInfo, thingStr, property) {
        checkArgs(cmdInfo, arguments);
        const [thing, lowerProp, realProp, value, propMap] = await this.thingProps(thingStr, property, null, cmdInfo);
        if (!thing)
            return;
        if (!propMap.has(lowerProp)) {
            return this.error('Bad property: ' + property);
        }
        if (reservedProperties.has(realProp) || addableProperties.has(realProp)) {
            return this.error('Reserved property: ' + property);
        }
        delete thing[realProp];
        thing.markDirty();
        this.output(`deleted ${property} from ${thing.name}`);
    }
    // COMMAND
    async atFind(cmdInfo, target, startStr) {
        checkArgs(cmdInfo, arguments);
        const start = startStr ? await this.find(startStr, this.thing, 'location') : this.thing;
        const thing = await this.find(target, start, 'target');
        this.output(await this.dumpName(thing));
    }
    // COMMAND
    async atInfo() {
        const hall = await this.world.getThing(this.world.hallOfPrototypes);
        const protos = [];
        for (const proto of await hall.getContents()) {
            protos.push(`%${proto._id} %proto:${proto.name}`);
        }
        this.output(`<pre>Name: ${this.world.name}
Your user name: ${this.user}${this.admin ? ' (admin)' : ''}
You: ${await this.dumpName(this.thing)}
lobby: ${await this.dumpName(this.world.lobby)}
limbo: ${await this.dumpName(this.world.limbo)}
hall of prototypes: ${await this.dumpName(this.world.hallOfPrototypes)}

Prototypes:
  ${protos.join('<br>  ')}
</pre>`);
    }
    // COMMAND
    async atPrototypes() {
        const hall = await this.world.getThing(this.world.hallOfPrototypes);
        this.output(`Prototypes:<br><br>${(await hall.getContents()).map(t => this.dumpName(t)).join('<br>')}`);
    }
    // COMMAND
    help(cmdInfo, cmd) {
        let cmds = [...commands.keys()].filter(k => !commands.get(k).admin || this.admin);
        let result = '';
        let argLen = 0;
        if (!this.thing) {
            cmds = ['help', 'login'];
        }
        if (cmd && cmds.indexOf(cmd) === -1) {
            return this.error(`Command not found: ${cmd}`);
        }
        for (const name of cmds) {
            const help = commands.get(name).help;
            for (let i = 0; i < help.length; i += 2) {
                argLen = Math.max(argLen, name.length + 1 + help[i].length);
            }
        }
        cmds.sort();
        for (const name of cmds) {
            const command = commands.get(name);
            if (command.alt)
                continue;
            if (result)
                result += '\n';
            result += helpText(argLen, command);
        }
        this.output('<pre>' + result + `

You can use <b>me</b> for yourself, <b>here</b> for your location, and <b>out</b> for your location's location (if you're in a container)${this.admin ? `
You can use <b>%lobby</b>, <b>%limbo</b>, and <b>%protos</b> for the standard rooms
You can use <b>%proto:name</b> for a prototype
You can use <b>%NUMBER</b> for an object by its ID (try <b>@dump me</b> for an example)
You can use <b>%-NUMBER</b> for an item you created recently (<b>%-1</b> is the last item, <b>%-2</b> is the next to last, etc.)

To make something into a prototype, move it to <b>%protos</b>

Format words:
  <b>\$this</b>      -- formatted string for this object or "you" if the user is the thing
  <b>\$name</b>      -- this object\'s name
  <b>\$is</b>        -- is or are, depending on the plurality of the thing
  <b>\$s</b>         -- optional "s" depending on the plurality of the thing (or "es" if it\'s after go)
  <b>\$location</b>  -- the thing\'s location
  <b>\$owner</b>     -- the link\'s owner (if this is a link)
  <b>\$link</b>      -- the link\'s destination (if this is a link)
  <b>\$contents</b>  -- the things\'s contents
  <b>\$links</b>     -- the things\'s links
  <b>\$forme</b>     -- following content is for messages shown to a command\'s actor
  <b>\$forothers</b> -- following content is for messages shown to observers of a command\'s actor
  <b>\$arg</b>       -- first argument (if there is one)
  <b>\$argN</b>      -- Nth argument (if there is one)
` : ''}</pre>`);
    }
}
function helpText(argLen, command) {
    let result = '';
    if (command.alts) {
        for (const alt of command.alts) {
            if (result)
                result += '\n';
            result += `<b>${alt.name} ${alt.help[0]}</b>`;
        }
    }
    for (let i = 0; i < command.help.length; i += 2) {
        const args = command.name + ' ' + command.help[i];
        if (result)
            result += '\n';
        result += `<b>${args}</b>`;
        if (command.help[i + 1]) {
            result += indent(argLen - args.length, '') + '  --  ' + command.help[i + 1];
        }
    }
    return result;
}
function indent(spaceCount, str) {
    let spaces = '';
    for (let i = 0; i < spaceCount; i++) {
        spaces += ' ';
    }
    return str.replace(/(^|\n)/g, '$1' + spaces);
}
function dropArgs(count, cmdInfo) {
    return cmdInfo.line.split(/( +)/).slice(count * 2).join('');
}
export function capitalize(str, templateWord = '') {
    return !templateWord || templateWord[0].toUpperCase() === templateWord[0]
        ? str[0].toUpperCase() + str.substring(1)
        : str;
}
function checkArgs(cmdInfo, args) {
    check(args.length >= cmdInfo.command.minArgs + 1, 'Not enough arguments to ' + cmdInfo.command.name);
}
function check(test, msg) {
    if (!test)
        throw new Error(msg);
}
function formatContexts(format) {
    const contexts = format.split(/(\s*\$forme\b\s*|\s*\$forothers\b\s*)/);
    const tmp = {};
    if (contexts.length > 1) {
        for (let i = 1; i < contexts.length; i += 2) {
            tmp[contexts[i].trim().substring(1).toLowerCase()] = contexts[i + 1];
        }
        return { me: tmp.forme, others: tmp.forothers };
    }
    return { others: contexts[0] };
}
////
//// CONTROL API
////
//// At this point it's just telnet
////   You send command strings to the (remote or local) MUD
////   The MUD sends back HTML strings to output
////
/**
 * send a command to the controller
 */
export async function executeCommand(text) {
    if (roleTracker.value === RoleState.Solo || roleTracker.value === RoleState.Host) {
        await connection.command(text);
    }
    else if (peerTracker.value !== PeerState.disconnected && mudTracker.value === MudState.Playing) {
        mudproto.command(text);
    }
}
export function runMud(world, handleOutput) {
    activeWorld = world;
    connection = new MudConnection(world, handleOutput);
    connection.start();
}
export function quit() {
    // tslint:disable-next-line:no-floating-promises
    connection?.close();
    connection = null;
}
//# sourceMappingURL=mudcontrol.js.map