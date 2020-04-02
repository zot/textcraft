import { MudState, RoleState, PeerState, mudTracker, roleTracker, peerTracker, } from './base.js';
import * as mudproto from './mudproto.js';
let app;
let connection;
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
const setHelp = [
    'thing property value', `Set one of these properties on a thing:
  prototype   -- see the @info command
  article     -- the article for a thing's name
  name        -- the thing's fullName (the name will be set to the first word)
  count       -- how many there are of the thing (defaults to 1)
  location    -- move the thing to another location
  linkowner   -- set the thing's linkOwner
  otherlink   -- set the thing's otherLink
  description -- the thing's description, you can use the following format words in a description
                 (if you capitalize a format word, the substitution will be capitalized):
     \$is       -- is or are, depending on the thing's count (does not capitalize)
     \$s        -- optional s, if count is 1 (like run$s, does not capitalize)
     \$this     -- the thing
     \$links    -- the thing's links
     \$contents -- the thing's contents
     \$location -- the thing's location
     \$owner    -- the link's owner when the thing acts as a link
     \$link     -- the link's destination when the thing acts as a link
`
];
class Command {
    constructor({ help, admin, alt }) {
        this.help = help;
    }
}
const commands = new Map([
    ['help', new Command({ help: ['', 'Show this message'] })],
    ['login', new Command({ help: ['user password', 'Login to the mud'] })],
    ['look', new Command({ help: ['', `See a description of your current location`,
                'thing', 'See a description of a thing'] })],
    ['go', new Command({ help: ['location', `move to another location (may be a direction)`] })],
    ['@dump', new Command({ help: ['thing', 'See properties of a thing'] })],
    ['@create', new Command({ help: ['proto', 'Create a thing'] })],
    ['@find', new Command({ help: ['thing', 'Find a thing',
                'thing location', 'Find a thing from a location',] })],
    ['@link', new Command({ help: ['loc1 link1 link2 exit2', 'create links between two things'] })],
    ['@info', new Command({ help: ['', 'List important information'] })],
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
    }
    async propagate(thing) {
        if (!thing || this.visited.has(thing))
            return;
        this.visited.add(thing);
        this.visitFunc(thing);
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
    async configure(user, thing) {
        this.user = user;
        this.thing = await this.world.getThing(thing);
        connectionMap.set(this.thing, this);
    }
    async close() {
        this.thing.setLocation(this.thing.world.limbo);
        connectionMap.delete(this.thing);
        this.world = null;
        this.user = null;
        this.admin = false;
        this.thing = null;
        this.outputHandler = null;
        this.created = null;
        mudTracker.setValue(MudState.NotPlaying);
        roleTracker.setValue(RoleState.None);
    }
    error(text) {
        this.output('<div class="error">' + text + '</div>');
    }
    output(text) {
        this.outputHandler(text);
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
    async format(tip, str) {
        if (!str)
            return str;
        const thing = await this.world.getThing(tip);
        const parts = str.split(/( *\$\w*)/);
        let result = '';
        for (const part of parts) {
            const match = part.match(/^( *)\$(.*)$/);
            if (match) {
                const [_, space, format] = match;
                result += space;
                switch (format.toLowerCase()) {
                    case 'this': {
                        let name;
                        if (thing === this.thing) {
                            name = 'you';
                        }
                        else {
                            name = thing.formatName();
                        }
                        result += capitalize(name, format);
                        continue;
                    }
                    case 'is': {
                        result += thing && (thing.count !== 1 || thing === this.thing) ? 'are' : 'is';
                        continue;
                    }
                    case 's': {
                        result += !thing || thing.count === 1 ? 's' : '';
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
                            result += capitalize(dest.formatName(), format);
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
        return escape(thing ? `%${thing._id} ${thing.formatName()}` : 'null');
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
    command(line) {
        const words = line.split(/\s+/);
        this.output('<div class="input">&gt; <span class="input-text">' + line + '</span></div>');
        words[0] = words[0].toLowerCase();
        if (this.thing ? commands.has(words[0]) : words[0] === 'login' || words[0] === 'help') {
            const command = commands.get(words[0]);
            if (command.admin && !this.admin) {
                return this.error('Unknown command: ' + words[0]);
            }
            if (words[0][0] === '@') {
                words[0] = 'at' + capitalize(words[0].substring(1));
            }
            // execute command inside a transaction so it will automatically store any dirty objects
            this.world.doTransaction(() => this[words[0]]({ command, line }, ...words.slice(1)))
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
                                                : await start.find(name);
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
        for (const key of Object.keys(thing)) {
            if (key !== '_id' && key[0] === '_') {
                propMap.set(key.substring(1).toLowerCase(), key);
            }
        }
        if (propMap.has(lowerProp)) {
            realProp = propMap.get(lowerProp);
            const curVal = thing[property];
            switch (typeof curVal) {
                case 'number':
                    value = Number(value);
                    break;
                case 'boolean':
                    value = Boolean(value);
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
            this.user = user;
            this.thing = thing;
            this.admin = admin;
            this.output('Connected.');
            await this.commandDescripton('has arrived');
            // tslint:disable-next-line:no-floating-promises
            this.look(null, null);
        }
        catch (err) {
            this.error(err.message);
        }
    }
    async commandDescripton(action, except) {
        const text = `${this.thing.formatName()} ${action}`;
        const desc = new Descripton(thing => {
            connectionMap.get(thing)?.output(text);
        });
        if (except)
            desc.visited.add(except);
        return desc.propagate(this.thing);
    }
    ///
    /// COMMANDS
    ///
    // COMMAND
    login(cmdInfo, user, password) {
        return this.doLogin(user, password);
    }
    // COMMAND
    async look(cmdInfo, target) {
        if (target) {
            const thing = await this.find(target, this.thing, 'object');
            if (!thing) {
                this.output(`You don't see any ${target}`);
                return this.commandDescripton(`looks for a ${target} but doesn't see any`);
            }
            else {
                this.output(await this.description(thing));
                if (thing === this.thing) {
                    return this.commandDescripton(`looks at themself`);
                }
                else {
                    return this.commandDescripton(`looks at ${await this.describe(thing)}`);
                }
            }
        }
        else {
            this.output(await this.examination(await this.thing.getLocation()));
            return this.commandDescripton(`looks around`);
        }
    }
    // COMMAND
    async go(cmdInfo, locationStr) {
        let location = await this.find(locationStr, this.thing, 'location');
        const link = location._otherLink && await location.getOtherLink();
        if (link) {
            location = link && await link.getLinkOwner();
            if (!location) {
                return this.error(`${locationStr} does not lead anywhere`);
            }
        }
        await this.thing.setLocation(location);
        this.output(`Moved ${link ? link.formatName() + ' to' : ''} ${location.formatName()}`);
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
            const thing = await this.world.createThing(name, dropArgs(3, cmdInfo));
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
            result += `\n   ${propName}: ${escape(thing[prop])}`;
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
        this.output(`Moved ${thingStr} to ${locStr}`);
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
        const [thing, lowerProp, realProp, val] = await this.thingProps(thingStr, property, value, cmdInfo);
        value = val;
        if (!thing)
            return;
        switch (lowerProp) {
            case 'count':
                thing.count = Number(value);
                break;
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
        if (reservedProperties.has(propMap(lowerProp))) {
            return this.error('Reserved property: ' + property);
        }
        delete thing[propMap.get(lowerProp)];
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
            if (command.alts) {
                for (const alt of command.alts) {
                    if (result)
                        result += '\n';
                    result += `<b>${alt.name} ${alt.help[0]}</b>`;
                }
            }
            for (let i = 0; i < command.help.length; i += 2) {
                const args = name + ' ' + command.help[i];
                if (result)
                    result += '\n';
                result += `<b>${args}</b>`;
                if (command.help[i + 1]) {
                    result += indent(argLen - args.length, '') + '  --  ' + command.help[i + 1];
                }
            }
        }
        this.output('<pre>' + result + `

You can use <b>me</b> for yourself, <b>here</b> for your location, and <b>out</b> for your location's location (if you're in a container)${this.admin ? `
You can use %lobby, %limbo, and %protos for the standard rooms
You can use %proto:name for a prototype
You can use %NUMBER for an object by its ID (try <b>@dump me</b> for an example)
You can use %-N for an item you created recently (%-1 is the last item, %-2 is the next to last, etc.)` : ''}</pre>`);
    }
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
export function escape(text) {
    return typeof text === 'string' ? text.replace(/</g, '&lt;') : text;
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
export function executeCommand(text) {
    if (roleTracker.value === RoleState.Solo || roleTracker.value === RoleState.Host) {
        connection.command(text);
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