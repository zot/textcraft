import { MudState, RoleState, PeerState, mudTracker, roleTracker, peerTracker, } from './base.js';
import { Thing, findSimpleName, escape, } from './model.js';
import * as mudproto from './mudproto.js';
export let connection;
// probably should move this into World
const connectionMap = new Map();
export let activeWorld;
const quotePat = /("(?:[^"\\]|\\.)*")/;
const valuePat = /^("([^"\\]|\\.)*"|([0-9]*\.)?[0-9]+|true|false|null)$/;
const thingPat = /^([a-zA-Z][a-zA-Z0-9]*|%[0-9]+|%[a-zA-Z]+|%[a-zA-z]+:[a-zA-Z]+)(?:\.([0-9]+|[a-zA-Z][a-zA-Z0-9]*))?$/;
const ifPat = /(?:^|\s)(@if|@then|@else|@elseif|@end)\b/;
const tokPrecLevels = [
    ['!'],
    ['in', 'match'],
    ['*', '/'],
    ['+', '-'],
    ['<', '<=', '==', '>=', '>'],
    ['&&'],
    ['||'],
];
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
const setHelp = ['thing property value', `Set one of these properties on a thing:
  prototype   -- see the @info command
  article     -- the article for a thing's name
  name        -- the thing's fullName (the name will be set to the first word)
  count       -- how many there are of the thing (defaults to 1)
  location    -- move the thing to another location
  linkowner   -- set the thing's linkOwner
  otherlink   -- set the thing's otherLink
  description -- the thing's description, you can use format words in a description (see FORMAT WORDS).
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
    closed          -- whether this object propagates descriptons to its location
    template        -- whether to copy this object during a move command
    cmd             -- command template for when the object's name is used as a command
    cmd_WORD        -- command template for when the WORD is used as a command
    get             -- command template for when someone tries to get the object
    get_WORD        -- command template for when someone tries to get WORD
    go              -- command template for when someone tries to go into in object or through a link
    go_WORD         -- command template for when someone tries to go into WORD (virtual directions)
    react_EVENT     -- react to an event (or descripton), see EVENTS
`
];
const adminHelp = `
You can use <b>%lobby</b>, <b>%limbo</b>, and <b>%protos</b> for the standard rooms
You can use <b>%proto:name</b> for a prototype
You can use <b>%NUMBER</b> for an object by its ID (try <b>@dump me</b> for an example)
You can use <b>%-NUMBER</b> for an item you created recently (<b>%-1</b> is the last item, <b>%-2</b> is the next to last, etc.)
You can use <b>%result</b> to refer to the result of the active successful if-condition
You can use <b>%result.PROPERTY</b> to refer to a property of the result (including numeric indexes)
You can use <b>%event</b> to refer to the current event (descripton)
You can use <b>%event.PROPERTY</b> to refer to a property of the current event (descripton)

To make something into a prototype, move it to <b>%protos</b>

FORMAT WORDS:
  <b>\$this</b>        -- formatted string for this object or "you" if the user is the thing
  <b>\$name</b>        -- this object\'s name
  <b>\$is</b>          -- is or are, depending on the plurality of the thing
  <b>\$s</b>           -- optional "s" depending on the plurality of the thing (or "es" if it\'s after go)
  <b>\$location</b>    -- the thing\'s location
  <b>\$owner</b>       -- the link\'s owner (if this is a link)
  <b>\$link</b>        -- the link\'s destination (if this is a link)
  <b>\$contents</b>    -- the things\'s contents
  <b>\$links</b>       -- the things\'s links
  <b>\$forme</b>       -- following content is for messages shown to a command\'s actor
  <b>\$forothers</b>   -- following content is for messages shown to observers of a command\'s actor
  <b>\$arg</b>         -- first argument (if there is one)
  <b>\$argN</b>        -- Nth argument (if there is one)
  <b>\$result</b>      -- The result of the active successful if-condition
  <b>\$result.PROP</b> -- A property of the current result (including numeric indexes)
  <b>\$event</b>       -- The current event (descripton)
  <b>\$event.PROP</b>  -- A property of the current event (descripton)


COMMAND TEMPLATES:

Command templates are string properties on objects to implement custom commands.
Example command template properties are get_key, cmd, and cmd_whistle -- see the help for @set.
Templates replace the original command with different commands, separated by semicolons.
Templates can contain $0..$N to refer to the command arguments. $0 refers to the thing itself.


EXPRESSIONS:

The following are legal expressions:
   number
   string
   boolean
   null
   undefined
   THING
   THING.property
   %any.property   -- returns the first value found on you or thing in your inventory
                      If property is a collection, it returns the union of all found
   '(' expr ')'
   expr1 + expr2
   expr1 - expr2
   expr1 * expr2
   expr1 / expr2
   expr1 < expr2
   expr1 <= expr2
   expr1 > expr2
   expr1 >= expr2
   Expr1 == expr2
   expr1 != expr2
   !expr1
   expr1 && expr2
   expr1 || expr2
   expr1 in expr2  -- returns whether expr1 is in expr2 (which must be a collection or a thing)


EVENTS:

When a thing executes a command, it emits an event which propagates to nearby things. Objects can react
to a type of event by setting a property called react_EVENT to a command template (see COMMAND TEMPLATES).
Events have properties which you can access in command templates with %event.PROPERTY and in format
strings with $event.PROPERTY.

Example, this will make a box react to people arriving in its location:

@set box react_go @if %event.1 == $0.location @then say Hello %event.source!


EVENT PROPERTIES:

   failed  -- whether the event is from a failed command
   source  -- the thing that emitted the event
   tick    -- the current tick number
   N       -- %event.0 ... %event.N and $event.0 ... $event.N refer to parameters in the event


EVENT TYPES:

These are the standard event types, listed with their standard parameters:

   get 0:thing
   drop 0:thing
   go 0:oldLocation 1:newLocation
   look 0:thing
   examine 0:thing
   tick
   say 0:text
   act 0:text 1:thing(opt)
`;
export class Command {
    constructor({ help, admin, alt }) {
        this.help = help;
        this.admin = admin;
        this.alt = alt;
    }
}
export const commands = new Map([
    ['help', new Command({ help: ['', 'Show this message'] })],
    ['login', new Command({ help: ['user password', 'Login to the mud'] })],
    ['look', new Command({
            help: ['', `See a description of your current location`,
                'thing', 'See a description of a thing']
        })],
    ['examine', new Command({
            help: ['thing', 'See a detailed description of a thing']
        })],
    ['go', new Command({ help: ['location', `move to another location (may be a direction)`] })],
    ['i', new Command({ help: [''], alt: 'inventory' })],
    ['invent', new Command({ help: [''], alt: 'inventory' })],
    ['inventory', new Command({ help: ['', `list what you are carrying`] })],
    ['say', new Command({ help: ['words...', `Say something`] })],
    ['whisper', new Command({ help: ['thing words...', `Say something to thing`] })],
    ['act', new Command({ help: ['words...', `Do something`] })],
    ['gesture', new Command({ help: ['thing words...', `Do something towards thing`] })],
    ['get', new Command({
            help: ['thing', `grab a thing`, 'thing [from] location', `grab a thing from a location`]
        })],
    ['drop', new Command({ help: ['thing', `drop something you are carrying`] })],
    ['@dump', new Command({ help: ['thing', 'See properties of a thing'] })],
    ['@move', new Command({ help: ['thing location', 'Move a thing'] })],
    ['@output', new Command({
            help: ['contextThing "FORMAT" arg... @event actor EVENT arg...',
                `Output text to the user and/or others using a format string on contextThing
  if the format is for others, @output will issue a descripton using information after @event
  actor can change output depending on who receives it`]
        })],
    ['@mute', new Command({ help: ['', 'temporarily silence all output commands that are not yours'] })],
    ['@unmute', new Command({ help: ['', 'enable output from other commands'] })],
    ['@quiet', new Command({ help: ['', 'disable all output for this command'] })],
    ['@loud', new Command({ help: ['', 'enable all output for this command'] })],
    ['@admin', new Command({ help: ['thing boolean', 'Change a thing\'s admin privileges'] })],
    ['@create', new Command({ help: ['proto name [description words...]', 'Create a thing'] })],
    ['@toast', new Command({ help: ['thing...', 'Toast things and everything they\'re connected to'] })],
    ['@copy', new Command({
            help: ['thing', '',
                'thing force', `Copy a thing to your inventory (force allows copying the entire world -- can be dangerous)`]
        })],
    ['@find', new Command({
            help: ['thing', 'Find a thing',
                'thing location', 'Find a thing from a location',]
        })],
    ['@link', new Command({ help: ['loc1 link1 link2 loc2', 'create links between two things'] })],
    ['@info', new Command({ help: ['', 'List important information'] })],
    ['@as', new Command({ help: ['thing command...', 'Make a thing execute a command'] })],
    ['@add', new Command({
            help: ['thing property thing2', `Add thing2 to the list or set in property
  If there is no property, create a set
  thing2 is optional`], admin: true
        })],
    ['@stop', new Command({ help: ['', `Stop the clock`], admin: true })],
    ['@start', new Command({ help: ['', `Start the clock`], admin: true })],
    ['@clock', new Command({ help: ['seconds', `Change the clock rate`], admin: true })],
    ['@remove', new Command({ help: ['thing property thing2', `Remove thing2 from the list in property`], admin: true })],
    ['@setNum', new Command({ help: ['thing property number'], admin: true, alt: '@set' })],
    ['@setBigint', new Command({ help: ['thing property bigint'], admin: true, alt: '@set' })],
    ['@setBool', new Command({ help: ['thing property boolean'], admin: true, alt: '@set' })],
    ['@set', new Command({ help: setHelp })],
    ['@del', new Command({ help: ['thing property', `Delete a properties from a thing so it will inherit from its prototype`] })],
    ['@reproto', new Command({ help: ['thing proto', `Change the prototype of a thing`] })],
    ['@expr', new Command({ help: ['thing property expr', `Set a property to the value of an expression`], admin: true })],
    ['@if', new Command({
            minArgs: 2,
            help: ['condition CLAUSES @end', `conditionally run commands
@if condition @then commands... @elseif condition @then commands ... @else commands... @end

@else and @end are optional, use @end if you nest @ifs
clauses can contain multiple commands separated by semicolons
Conditions can contain expressions -- see expressions

Example:
  @if me.x == 1 @then say one; @if true @then say derp @end @elseif me.x == 2 @then say two @else say other
`]
        })],
]);
export function init() { }
export function initCommands(cmds) {
    cmds.forEach(initCommand);
    return cmds;
}
export function initCommand(command, cmdName, cmds) {
    command.name = cmdName;
    if (command.minArgs === undefined) {
        command.minArgs = 1000;
    }
    command.name = cmdName;
    if (command.alt) {
        const alt = cmds.get(command.alt);
        if (!alt.alts)
            alt.alts = [];
        cmds.get(command.alt).alts.push(command);
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
export class Descripton {
    constructor(source, event, args, failed, visitFunc, visitLinks = false) {
        this.tick = connection.tickCount;
        this.source = source;
        this.event = event;
        this.failed = failed;
        this.args = args;
        this.visitFunc = visitFunc;
        this.visitLinks = visitLinks;
        this.visited = new Set();
        for (let i = 0; i < args.length; i++) {
            this[i] = args[i];
        }
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
export class MudConnection {
    constructor(thing) {
        this.muted = 0;
        this.acted = new Set();
        this.pendingReactions = new Map();
        this.tickCount = 0;
        this.ticking = false;
        this.stopClock = true;
        this.tickers = new Set();
        this.created = [];
        this.thing = thing;
        this.outputHandler = () => { };
    }
    init(world, outputHandler, remote = false) {
        this.world = world;
        this.outputHandler = outputHandler;
        this.remote = remote;
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
        if (!this.remote) {
            mudTracker.setValue(MudState.NotPlaying);
            roleTracker.setValue(RoleState.None);
        }
    }
    error(text) {
        const oldSup = this.suppressOutput;
        this.suppressOutput = false;
        this.output('<div class="error">' + text + '</div>');
        this.failed = true;
        this.suppressOutput = oldSup;
    }
    errorNoThing(thing) {
        this.error(`You don't see any ${thing} here`);
    }
    output(text) {
        if (!this.suppressOutput && this.muted < 1) {
            this.outputHandler(text.match(/^</) ? text : `<div>${text}</div>`);
        }
        this.failed = false;
    }
    async start() {
        if (!this.remote) {
            this.world.watcher = t => this.checkTicker(t);
            for (const thing of this.world.thingCache.values()) {
                this.checkTicker(thing);
            }
        }
        mudTracker.setValue(MudState.Playing);
        this.outputHandler(`Welcome to ${this.world.name}, use the "login" command to log in.
<p>
<p>
<p>Help lists commands...
<p>
<p>Click on old commands to reuse them`);
        await this.world.start();
    }
    formatMe(tip, str, ...args) {
        const ctx = formatContexts(str);
        return ctx.me ? this.basicFormat(tip, ctx.me, args) : '';
    }
    // same as formatOthers(...)
    format(tip, str, ...args) {
        return this.basicFormat(tip, formatContexts(str).others, args);
    }
    formatOthers(tip, str, ...args) {
        const ctx = formatContexts(str);
        return ctx.others ? this.basicFormat(tip, formatContexts(str).others, args) : '';
    }
    formatName(thing) {
        return `${thing.formatName()}${this.admin ? '(%' + thing._id + ')' : ''}`;
    }
    async basicFormat(tip, str, args) {
        if (!str)
            return str;
        const thing = await this.world.getThing(tip);
        const parts = str.split(/( *\$(?:result|event)(?:\.\w*)?| *\$\w*)/i);
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
                else if (format.match(/^result(?:\.\w+)?$/i)) {
                    const t = this.getResult(format, this.conditionResult);
                    result += t instanceof Thing ? this.formatName(t) : t;
                    continue;
                }
                else if (format.match(/^event(?:\.\w+)?$/i)) {
                    const t = this.getResult(format, this.currentEvent);
                    result += t instanceof Thing ? this.formatName(t) : t;
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
                        result += capitalize(this.formatName(await thing.getLocation()), format);
                        continue;
                    }
                    case 'owner': {
                        result += capitalize(this.formatName(await thing.getLinkOwner()), format);
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
    checkCommand(prefix, cmd, thing) {
        return (cmd === thing.name && thing[prefix]) || thing[`${prefix}_${cmd}`];
    }
    async findCommand(words, prefix = '_cmd') {
        const result = await this.findTemplate(words, prefix);
        if (result) {
            const [context, template] = result;
            return this.substituteCommand(template, [`%${context._id}`, ...words]);
        }
    }
    async findTemplate(words, prefix) {
        const cmd = words[0].toLowerCase();
        let template;
        for (const item of (await this.thing.getContents())) {
            template = this.checkCommand(prefix, cmd, item);
            if (template) {
                return [item, template];
            }
        }
        if (!template) {
            for (const item of (await this.thing.getLinks())) {
                template = this.checkCommand(prefix, cmd, item);
                if (template) {
                    return [item, template];
                }
            }
        }
        if (!template) {
            const loc = await this.thing.getLocation();
            template = this.checkCommand(prefix, cmd, loc);
            if (template) {
                return [loc, template];
            }
            else {
                for (const item of (await loc.getLinks())) {
                    template = this.checkCommand(prefix, cmd, item);
                    if (template) {
                        return [item, template];
                    }
                }
            }
        }
    }
    substituteCommand(template, args) {
        const lines = [];
        const words = args.map(a => a instanceof Thing ? `%${a.id}` : a);
        for (const line of template.split(/;/)) {
            const parts = line.split(/( *\$\w*)/);
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
            lines.push(newCmd.trim());
        }
        return lines.length > 0 ? lines : null;
    }
    async runCommands(lines) {
        if (lines) {
            for (const line of lines) {
                await this.command(line, true);
                if (this.failed)
                    break;
            }
        }
    }
    async command(line, substituted = false, user = false) {
        if (line[0] === '"' || line[0] === "'") {
            line = `say ${line.substring(1)}`;
        }
        else if (line[0] === ':') {
            line = `act ${line.substring(1)}`;
        }
        const words = line.split(/\s+/);
        const commandName = words[0].toLowerCase();
        if (!substituted) {
            this.output('<div class="input">&gt; <span class="input-text">' + escape(line) + '</span></div>');
            if (!this.commands.has(commandName) && this.thing) {
                const newCommands = await this.findCommand(words);
                if (newCommands)
                    return this.runCommands(newCommands);
            }
        }
        if (this.thing ? this.commands.has(commandName) : commandName === 'login' || commandName === 'help') {
            let command = this.commands.get(commandName);
            if (command.alt)
                command = this.commands.get(command.alt);
            if (command?.admin && !this.admin && !substituted) {
                return this.error('Unknown command: ' + words[0]);
            }
            // execute command inside a transaction so it will automatically store any dirty objects
            await this.world.doTransaction(async () => {
                const muted = this.muted;
                try {
                    if (!substituted && user)
                        this.muted = 0;
                    await this[command.method]({ command, line, substituted }, ...words.slice(1));
                }
                finally {
                    if (this.muted === 0)
                        this.muted = muted;
                    if (!substituted)
                        this.suppressOutput = false;
                }
            })
                .catch(err => this.error(err.message));
        }
        else {
            this.output('Unknown command: ' + words[0]);
        }
        if (this.thing?.name !== this.myName) {
            this.myName = this.thing.name;
            mudproto.userThingChanged(this.thing);
        }
    }
    async findAll(names, start = this.thing, errTag = '') {
        const result = [];
        for (const name of names) {
            result.push(await this.find(name, start, errTag));
        }
        return result;
    }
    getResult(str, value) {
        const match = str.match(/^[^.]+(?:\.(\w+))?$/);
        return match[1] ? value[match[1]] : value;
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
                if (!result || result === this.world.limbo) {
                    throw new Error('You are not in a container');
                }
            }
            else {
                result = name === 'me' ? this.thing
                    : name === 'here' ? await this.thing.getLocation()
                        : name === '%limbo' ? this.world.limbo
                            : name === '%lobby' ? this.world.lobby
                                : name === '%protos' ? this.world.hallOfPrototypes
                                    : name.match(/^%result(\.\w+)?$/) ? this.getResult(name, this.conditionResult)
                                        : name.match(/^%event(\.\w+)?$/) ? this.getResult(name, this.currentEvent)
                                            : name.match(/^%proto:/) ? await this.world.hallOfPrototypes.find(name.replace(/^%proto:/, ''))
                                                : name.match(/%-[0-9]+/) ? this.created[this.created.length - Number(name.substring(2))]
                                                    : name.match(/%[0-9]+/) ? await this.world.getThing(Number(name.substring(1)))
                                                        : await start.find(name, this.thing._location === this.world.limbo.id ? new Set() : new Set([this.world.limbo]));
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
                    if (value.match(/^[0-9]+$/))
                        value = Number(value);
                    break;
                case 'boolean':
                    value = value.toLowerCase() in { t: true, true: true };
                    break;
                case 'bigint':
                    if (value.match(/^[0-9]+$/))
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
    async doLogin(user, password, name, noauthentication = false) {
        try {
            const [thing, admin] = await this.world.authenticate(user, password, name, noauthentication);
            this.user = user;
            this.thing = thing;
            this.myName = thing.name;
            //this.myName = thing.name
            this.admin = admin;
            connectionMap.set(this.thing, this);
            this.output('Connected.');
            mudproto.userThingChanged(this.thing);
            thing.setLocation(this.world.lobby);
            await this.commandDescripton(null, 'has arrived', 'go', [null]);
            // tslint:disable-next-line:no-floating-promises
            await this.look(null, null);
            if (!this.remote) {
                this.stopClock = false;
                this.queueTick();
            }
        }
        catch (err) {
            this.error(err.message);
        }
    }
    async commandDescripton(context, action, event, args, succeeded = true, prefix = true, excludeActor = true, startAt, actor = this.thing) {
        return this.formatDescripton(context, action, [], event, args, succeeded, prefix, excludeActor, startAt, actor);
    }
    async formatDescripton(actionContext, action, actionArgs, event, args, succeeded = true, prefix = true, excludeActor = true, startAt, actor = this.thing) {
        if (!this.suppressOutput) {
            const desc = new Descripton(actor, event, args, !succeeded, async (thing) => {
                const con = connectionMap.get(thing);
                if (con) {
                    // run format in each connection so it can deal with admin and names
                    const format = await con.basicFormat(actionContext, action, actionArgs);
                    const text = prefix ? `${con.formatName(this.thing)} ${format}` : format;
                    con.output(text);
                }
                else {
                    // process reactions in the main MudConnection
                    await connection.react(thing, desc);
                }
            });
            if (!startAt)
                startAt = await this.thing.getLocation();
            if (excludeActor)
                desc.visited.add(actor);
            return desc.propagate(startAt);
        }
    }
    async react(thing, desc) {
        if (this.remote)
            throw new Error(`Attempt to react in a remote connection`);
        const reactProp = `_react_${desc.event.toLowerCase()}`;
        let reacted = false;
        for (const key in thing) {
            if (key.toLowerCase() === reactProp) {
                await this.doReaction(thing, desc, thing[key]);
                reacted = true;
                break;
            }
        }
        if (!reacted && thing._react) {
            await connection.doReaction(thing, desc, thing._react);
        }
    }
    async doReaction(thing, desc, reaction) {
        if (this.remote)
            throw new Error(`Attempt to react in a remote connection`);
        if (this.acted.has(thing) && !this.pendingReactions.has(thing)) {
            this.pendingReactions.set(thing, () => this.doReaction(thing, desc, reaction));
            this.queueTick();
        }
        else {
            const oldEvent = this.currentEvent;
            try {
                this.currentEvent = desc;
                this.acted.add(thing);
                await this.connectionFor(thing).runCommands(this.substituteCommand(reaction, [thing, ...desc.args]));
            }
            finally {
                this.currentEvent = oldEvent;
            }
        }
    }
    connectionFor(thing) {
        let con = connectionMap.get(thing);
        if (!con) {
            con = new MudConnection(thing);
            con.admin = true;
            con.world = this.world;
            con.remote = true;
            con.currentEvent = this.currentEvent;
            con.conditionResult = this.conditionResult;
            con.suppressOutput = this.suppressOutput;
        }
        return con;
    }
    checkTicker(thing) {
        if (this.remote)
            throw new Error(`Attempt to tick in a remote connection`);
        if (thing._react_tick) {
            this.tickers.add(thing);
            this.queueTick();
        }
        else {
            this.tickers.delete(thing);
        }
    }
    queueTick(delay = this.world.clockRate, force = false) {
        if (this.shouldTick() && (force || !this.ticking)) {
            this.ticking = true;
            setTimeout((() => this.tick()), Math.max(100, delay));
        }
    }
    shouldTick() {
        if (this.remote)
            throw new Error(`Attempt to tick in a remote connection`);
        return !this.stopClock && this.world;
    }
    async tick() {
        if (this.shouldTick()) {
            const ticked = this.pendingReactions.size || this.tickers.size;
            const targetTime = Date.now() + Math.round(this.world.clockRate * 1000);
            this.ticking = true;
            this.tickCount++;
            this.acted = new Set();
            if (this.pendingReactions.size) {
                const reactions = this.pendingReactions;
                this.pendingReactions = new Map();
                for (const reaction of reactions.values()) {
                    reaction();
                }
            }
            if (this.tickers.size) {
                const tick = new Descripton(null, 'tick', [], false, () => { });
                for (const ticker of this.tickers) {
                    const reaction = ticker._react_tick;
                    if (reaction) {
                        tick.source = ticker;
                        await this.doReaction(ticker, tick, reaction);
                    }
                }
            }
            if (ticked) {
                this.queueTick(targetTime - Date.now(), true);
            }
            else {
                this.ticking = false;
            }
        }
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
    // the command is split into if-keywords (@if, @then, @else, @elseif, @end) and quoted strings
    // intervening clauses can contain if-keywords, quoted strings, and semicolons
    async runIfs(parts) {
        const clauses = findIfClauses(parts.slice(1));
        const [condition, conditionRest] = await this.computeExpr(exprTokens(clauses[0]));
        if (conditionRest.length) {
            throw new Error(`Extra text after condition: ${conditionRest.join(' ')}`);
        }
        if (condition) {
            try {
                this.conditionResult = condition;
                await this.runCommands(findCommands(clauses[1]));
                return;
            }
            finally {
                this.conditionResult = null;
            }
        }
        else {
            for (let i = 2; i < clauses.length - 1; i += 2) {
                const [elcondition, elconditionRest] = await this.computeExpr(exprTokens(clauses[i]));
                if (elconditionRest.length) {
                    throw new Error(`Extra text after condition: ${elconditionRest.join(' ')}`);
                }
                if (elcondition) {
                    try {
                        this.conditionResult = condition;
                        await this.runCommands(findCommands(clauses[i + 1]));
                        return;
                    }
                    finally {
                        this.conditionResult = null;
                    }
                }
            }
            if (clauses.length % 2 === 1) { // there is an else clause
                return this.runCommands(findCommands(clauses[clauses.length - 1]));
            }
        }
    }
    async computeExpr(toks, prec = tokPrecLevels.length) {
        const origExpr = toks.join(' ');
        let first;
        let second;
        while (toks.length) {
            if (toks[0] === '!') {
                const [fst, firstToks] = await this.parseItem(toks.slice(1));
                first = !fst;
                toks = firstToks;
            }
            else {
                const [fst, firstToks] = await this.parseItem(toks);
                first = fst;
                toks = firstToks;
            }
            if (!toks.length)
                break;
            const op = toks[0];
            const tokPrec = tokPrecLevels.findIndex(t => t.indexOf(op) > -1);
            if (tokPrec === -1)
                throw new Error(`Bad expression operator: ${op}`);
            if (tokPrec >= prec)
                return [first, toks];
            const [next, nextToks] = await this.computeExpr(toks.slice(1), tokPrec);
            second = next;
            toks = nextToks;
            switch (op) {
                case 'in':
                    if (typeof first === 'number')
                        first = await this.world.getThing(first);
                    if (!(first instanceof Thing))
                        throw new Error(`in only works on things: ${origExpr}`);
                    if (!second) {
                        first = false;
                    }
                    else if (second instanceof Thing) {
                        first = first._location === second.id;
                    }
                    else if ('indexOf' in second) {
                        first = second.indexOf(first._id) !== -1;
                    }
                    else if ('has' in second) {
                        first = second.has(first._id);
                    }
                    else {
                        throw new Error(`value for 'in' is not a collection: ${origExpr}`);
                    }
                    break;
                case 'match':
                    first = String(first).match(String(second));
                    break;
                case '*':
                    first = first * second;
                    break;
                case '/':
                    first = first / second;
                    break;
                case '+':
                    first = first + second;
                    break;
                case '-':
                    first = first - second;
                    break;
                case '<':
                    first = first < second;
                    break;
                case '<=':
                    first = first <= second;
                    break;
                case '==':
                    if ((first instanceof Thing) !== (second instanceof Thing)) {
                        first = first instanceof Thing ? first.id : first;
                        second = second instanceof Thing ? second.id : second;
                    }
                    first = first === second;
                    break;
                case '!=':
                    if ((first instanceof Thing) !== (second instanceof Thing)) {
                        first = first instanceof Thing ? first.id : first;
                        second = second instanceof Thing ? second.id : second;
                    }
                    first = first !== second;
                    break;
                case '>=':
                    first = first >= second;
                    break;
                case '>':
                    first = first > second;
                    break;
                case '&&':
                    first = first && second;
                    break;
                case '||':
                    first = first || second;
                    break;
                default:
                    throw new Error(`Unknown operator: ${op}`);
            }
        }
        return [first, toks];
    }
    // could be a number, string, boolean, name, name.property
    async parseItem(toks) {
        if (toks[0] === '(') {
            const [value, newToks] = await this.computeExpr(toks.slice(1));
            if (newToks[0] !== ')')
                throw new Error(`Unclosed parentheses: ${toks.join(' ')}`);
            return [value, newToks.slice(1)];
        }
        else if (toks[0].match(valuePat)) {
            return [JSON.parse(toks[0]), toks.slice(1)];
        }
        else if (toks[0] === 'undefined') {
            return [undefined, toks.slice(1)];
        }
        else if (toks[0].match(thingPat)) {
            const match = toks[0].match(thingPat);
            if (match[1] === '%any' && match[2]) { // currently just you and your stuff's properties
                const prop = `_${match[2]}`;
                const collection = new Set();
                let pair;
                let possible;
                let useCollection = false;
                pair = this.gatherAny(this.thing, prop, collection);
                if (pair) {
                    if (pair[0] !== undefined)
                        return [pair[0], toks.slice(1)];
                    possible = pair[1];
                    if (possible === undefined)
                        useCollection = true;
                }
                for (const item of await this.thing.getContents()) {
                    pair = this.gatherAny(item, prop, collection);
                    if (pair) {
                        if (pair[0] !== undefined)
                            return [pair[0], toks.slice(1)];
                        possible = pair[1];
                        if (possible === undefined)
                            useCollection = true;
                    }
                }
                if (possible !== undefined)
                    return [possible, toks.slice(1)];
                if (useCollection)
                    return [collection, toks.slice(1)];
                throw new Error(`Could not find a ${match[2]} property`);
            }
            const thing = await this.find(match[1]);
            if (!thing)
                throw new Error(`Could not find thing ${match[1]}`);
            if (match[2]) {
                if (thing instanceof Thing)
                    return [thing['_' + match[2]], toks.slice(1)];
                return [thing[match[2]], toks.slice(1)];
            }
            else {
                return [thing, toks.slice(1)];
            }
        }
        else {
            throw new Error(`Could not parse ${toks[0]}`);
        }
    }
    gatherAny(thing, prop, collection) {
        if (prop in thing) {
            if (Array.isArray(thing[prop]) || thing[prop] instanceof Set) {
                for (const item of thing[prop]) {
                    collection.add(item);
                }
                return [undefined, undefined];
            }
            else {
                return thing.hasOwnProperty(prop) ? [thing[prop], null] : [undefined, thing[prop]];
            }
        }
    }
    // COMMAND
    login(cmdInfo, user, password) {
        return this.doLogin(user, password, user);
    }
    // COMMAND
    async look(cmdInfo, target) {
        const thing = await (target ? this.find(target, this.thing) : this.thing.getLocation());
        if (!thing) {
            this.errorNoThing(target);
            return this.commandDescripton(null, `looks for a ${target} but doesn't see any`, 'look', [], false);
        }
        else if (thing === this.thing) {
            this.output(await this.examination(thing));
            return this.commandDescripton(null, `looks at themself`, 'examine', [thing]);
        }
        else if (thing.id === this.thing._location) {
            this.output(await this.examination(await this.thing.getLocation()));
            return this.commandDescripton(null, `looks around`, 'examine', [thing]);
        }
        else {
            this.output(await this.description(thing));
            return this.formatDescripton(null, 'looks at $arg', [thing], 'look', [thing]);
        }
    }
    // COMMAND
    async examine(cmdInfo, target) {
        if (!target) {
            this.error(`What do you want to examine ? `);
        }
        else {
            const thing = await this.find(target, this.thing);
            if (!thing) {
                this.errorNoThing(target);
                return this.commandDescripton(null, `tries to examine a ${target} but doesn't see any`, 'examine', [], false);
            }
            else {
                this.output(await this.examination(thing));
                if (thing === this.thing) {
                    return this.commandDescripton(null, `looks at themself`, 'examine', [thing]);
                }
                else if (thing.id === this.thing._location) {
                    return this.commandDescripton(null, `looks around`, 'examine', [thing]);
                }
                else {
                    return this.formatDescripton(null, 'examines $arg', [thing], 'examine', [thing]);
                }
            }
        }
    }
    // COMMAND
    async go(cmdInfo, directionStr) {
        if (!cmdInfo.substituted) {
            const cmd = await this.findCommand([directionStr, 'me'], '_go');
            if (cmd)
                return this.runCommands(cmd);
        }
        const oldLoc = await this.thing.getLocation();
        const direction = await this.find(directionStr, this.thing, 'direction');
        let location;
        const visited = new Set();
        let tmp = direction;
        while (tmp !== this.world.limbo) {
            if (visited.has(tmp))
                throw new Error(`${this.formatName(direction)} is in a circularity`);
            visited.add(tmp);
            if (tmp === this.thing) {
                throw new Error('You cannot go into something you are holding');
            }
            tmp = await (tmp._linkOwner ? tmp.getLinkOwner() : tmp.getLocation());
        }
        if (!direction._linkOwner) {
            this.thing.setLocation(direction);
            const ctx = formatContexts(direction._contentsEnterFormat);
            ctx.me && this.output(await this.basicFormat(direction, ctx.me, [this.thing]));
            if (ctx.others) {
                await this.formatDescripton(direction, ctx.others, [this.thing], 'go', [oldLoc], true, true, true, this.thing);
            }
        }
        else {
            const link = direction._otherLink && await direction.getOtherLink();
            if (link) {
                location = link && await link.getLinkOwner();
                if (!location) {
                    return this.error(`${directionStr} does not lead anywhere`);
                }
            }
            const output = await this.formatMe(direction, direction._linkMoveFormat, this.thing, oldLoc, location);
            const exitCtx = formatContexts(direction._linkExitFormat);
            exitCtx.others && await this.formatDescripton(direction, exitCtx.others, [this.thing, oldLoc], 'go', [oldLoc, location], true, false);
            this.thing.setLocation(location);
            output && this.output(output);
            const enterCtx = formatContexts(direction._linkEnterFormat);
            await this.formatDescripton(link, enterCtx.others, [this.thing, location], 'go', [oldLoc, location], true, false);
        }
        await this.look(cmdInfo);
    }
    // COMMAND
    async inventory(cmdInfo) {
        this.output(`<pre>You are carrying\n${indent(3, (await this.thing.getContents()).map(item => this.formatName(item)).join('\n'))}</pre>`);
    }
    // COMMAND
    atQuiet() {
        this.suppressOutput = true;
    }
    // COMMAND
    atLoud() {
        this.suppressOutput = false;
    }
    // COMMAND
    atStart() {
        this.stopClock = false;
        this.output('Clock started');
        this.queueTick(undefined, true);
    }
    // COMMAND
    async atClock(cmdInfo, rate) {
        if (rate.match(/^[0-9]+$/)) {
            this.world.clockRate = Number(rate);
            await this.world.store();
        }
    }
    // COMMAND
    atStop() {
        this.stopClock = true;
        this.output('Clock stopped');
    }
    // COMMAND
    atMute() {
        this.output('Muted');
        this.muted = 1;
    }
    // COMMAND
    atUnmute() {
        this.muted = -1;
        this.output('Unmuted');
    }
    // COMMAND
    async get(cmdInfo, thingStr, ...args) {
        const location = await this.thing.getLocation();
        let loc = location;
        let newCommands;
        if (args.length) {
            const [_, name] = findSimpleName(args.join(' '));
            loc = await this.find(name, loc);
            if (!loc)
                return this.errorNoThing(name);
        }
        const thing = await this.find(thingStr, loc);
        if (thing) {
            const cmd = this.checkCommand('_get', thingStr, thing);
            if (cmd)
                newCommands = this.substituteCommand(cmd, [`%${thing._id}`, ...dropArgs(1, cmdInfo).split(/\s+/)]);
        }
        if (!newCommands && !thing) {
            newCommands = (await this.findCommand(dropArgs(1, cmdInfo).split(/\s+/), '_get'));
        }
        if (newCommands)
            return this.runCommands(newCommands);
        if (!thing)
            return this.errorNoThing(thingStr);
        if (thing === this.thing)
            return this.error(`You just don't get yourself. Some people are that way.`);
        if (thing === location)
            return this.error(`You just don't get this place. Some people are that way.`);
        thing.setLocation(this.thing);
        this.output(`You pick up ${this.formatName(thing)}`);
        return this.commandDescripton(thing, 'picks up $this', 'get', [thing]);
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
        return this.commandDescripton(thing, 'drops $this', 'drop', [thing]);
    }
    // COMMAND
    async say(cmdInfo, ...words) {
        const text = escape(dropArgs(1, cmdInfo));
        this.output(`You say, "${text}"`);
        return this.commandDescripton(null, `says, "${text}"`, 'say', [text]);
    }
    // COMMAND
    async whisper(cmdInfo, thingStr, ...words) {
        const thing = await this.find(thingStr);
        const text = escape(dropArgs(2, cmdInfo));
        if (!thing)
            return this.errorNoThing(thingStr);
        connectionMap.get(thing)?.output(`${this.formatName(this.thing)} whispers, "${text}", to you`);
        this.output(`You whisper, "${text}", to ${this.formatName(thing)}`);
    }
    // COMMAND
    async act(cmdInfo, ...words) {
        const text = escape(dropArgs(1, cmdInfo));
        return this.commandDescripton(this.thing, '<i>$this ${text}</i>', 'act', [text], true, false, false);
    }
    // COMMAND
    async gesture(cmdInfo, thingStr, ...words) {
        const thing = await this.find(thingStr);
        const text = escape(dropArgs(2, cmdInfo));
        if (!thing)
            return this.errorNoThing(thingStr);
        await this.formatDescripton(this.thing, '<i>$this ${text} at $arg</i>', [thing], 'act', [text, thing], true, false, false);
    }
    // COMMAND
    async atCreate(cmdInfo, protoStr, name) {
        const proto = await this.find(protoStr, this.world.hallOfPrototypes);
        if (!proto) {
            const hall = this.world.hallOfPrototypes;
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
            if (thing._prototype === this.world.roomProto.id) {
                this.output(`You created a room: ${await this.dumpName(thing)}`);
            }
            else if (thing._prototype === this.world.linkProto.id) {
                this.output(`You created a link: ${await this.dumpName(thing)}`);
            }
            else {
                thing.setLocation(this.thing);
                this.output(`You are holding your new creation: ${await this.dumpName(thing)}`);
            }
        }
    }
    // COMMAND
    async getPrototype(name) {
        return this.find(name, this.world.hallOfPrototypes, `${name} prototype`);
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
    async atOutput(cmdInfo /*, actor, text, arg..., @event, actor, event, arg...*/) {
        const words = splitQuotedWords(dropArgs(1, cmdInfo));
        // tslint:disable-next-line:prefer-const
        let [contextStr, text] = words;
        if (text[0] === '"')
            text = JSON.parse(text);
        const ctx = formatContexts(text);
        const context = await this.find(contextStr, undefined, 'context');
        const evtIndex = words.findIndex(w => w.toLowerCase() === '@event');
        if (evtIndex === -1 || words.length - evtIndex < 3) {
            throw new Error('@output needs @event actor eventType');
        }
        // tslint:disable-next-line:prefer-const
        let [actorStr, ...eventArgs] = words.slice(evtIndex + 1);
        const actor = await this.find(actorStr, undefined, 'actor');
        const formatWords = words.slice(2, evtIndex);
        const formatArgs = formatWords.length ? await this.findAll(formatWords) : [];
        let output = false;
        if (ctx.me) {
            if (connection.thing === actor) {
                const forMe = await connection.formatMe(context, text, ...formatArgs);
                connection.output(forMe);
                output = true;
            }
            else {
                for (const [thing, con] of connectionMap) {
                    if (thing === actor) {
                        const forMe = await connection.formatMe(actor, text, ...formatArgs);
                        con.output(forMe);
                        output = true;
                        break;
                    }
                }
            }
        }
        if (ctx.others) {
            let succeeded = true;
            if (eventArgs[0].toLowerCase() === 'false') {
                eventArgs = eventArgs.slice(1);
                succeeded = false;
            }
            const event = eventArgs[0];
            eventArgs = eventArgs.slice(1);
            for (let i = 0; i < eventArgs.length; i++) {
                const word = eventArgs[i];
                eventArgs[i] = word[0] === '"' ? JSON.parse(word[0])
                    : (await this.find(word)) || word;
            }
            return this.formatDescripton(context, ctx.others, formatArgs, event, eventArgs, succeeded, false, output, null, actor);
        }
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
    async atAs(cmdInfo, thingStr) {
        const thing = await this.find(thingStr, this.thing, 'actor');
        let con = connectionMap.get(thing);
        const cmd = dropArgs(2, cmdInfo);
        if (!cmd.trim())
            throw new Error(`@as expects a command`);
        if (!con) {
            con = new MudConnection(thing);
            con.admin = true;
            con.world = this.world;
            con.remote = true;
        }
        con.command(cmd, false, true);
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
        if (user.admin !== boolVal) {
            user.admin = boolVal;
            await this.world.putUser(user);
            if (con)
                con.admin = boolVal;
            if (boolVal)
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
        if (!thing[prop]) {
            thing[prop] = [thing2._id];
        }
        else if (thing[prop].indexOf(thing2._id) === -1) {
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
    async atReproto(cmdInfo, thingStr, protoStr) {
        checkArgs(cmdInfo, arguments);
        const thing = await this.find(thingStr, this.thing, 'thing');
        const proto = await this.find(protoStr, this.thing, 'prototype');
        thing.__proto__ = proto;
        thing.markDirty(thing._prototype = proto.id);
        this.output(`You changed the prototype of ${this.formatName(thing)} to ${this.formatName(proto)}`);
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
        if (addableProperties.has(realProp))
            return this.error(`Cannot set ${property}`);
        thing.markDirty(null);
        switch (lowerProp) {
            case 'react_tick':
                thing._react_tick = String(value);
                this.checkTicker(thing);
                break;
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
                const proto = await this.find(value, this.world.hallOfPrototypes);
                if (!proto) {
                    this.error('Could not find prototype ' + value);
                    return;
                }
                await thing.setPrototype(proto);
                break;
            default:
                if (value instanceof Thing)
                    value = value.id;
                thing.markDirty(thing[realProp] = value);
                break;
        }
        this.output(`set ${thingStr} ${property} to ${value}`);
    }
    async atCopy(cmdInfo, thingStr, force) {
        checkArgs(cmdInfo, arguments);
        const thing = await this.find(thingStr, this.thing, 'thing');
        const connected = await thing.findConnected();
        if (!force) {
            for (const item of connected) {
                if (item === this.world.limbo) {
                    throw new Error(`${thingStr} is connected to Limbo, use force to copy anyway`);
                }
                else if (item === this.world.lobby) {
                    throw new Error(`${thingStr} is connected to the Lobby, use force to copy anyway`);
                }
                else if (item === this.world.hallOfPrototypes) {
                    throw new Error(`${thingStr} is connected to the Hall of Prototypes, use force to copy anyway`);
                }
                else if (connectionMap.has(item)) {
                    throw new Error(`${this.formatName(item)} has a player, use force to copy anyway`);
                }
            }
        }
        const newThing = await thing.copy(this.thing, connected);
        this.created.push(newThing);
        this.output(`You copied ${this.formatName(thing)} to your inventory`);
    }
    async atToast(cmdInfo, thingStr) {
        checkArgs(cmdInfo, arguments);
        const things = [...arguments].slice(1).map(async (t) => await this.find(t, this.thing, 'thing'));
        let out = '';
        for await (const thing of things) {
            const connected = await thing.findConnected();
            for (const item of connected) {
                if (item === this.world.limbo) {
                    throw new Error(`${this.formatName(thing)} is connected to Limbo`);
                }
                else if (item === this.world.lobby) {
                    throw new Error(`${this.formatName(thing)} is connected to the Lobby`);
                }
                else if (item === this.world.hallOfPrototypes) {
                    throw new Error(`${this.formatName(thing)} is connected to the Hall of Prototypes`);
                }
                else if (connectionMap.has(item)) {
                    throw new Error(`${this.formatName(item)} has a player`);
                }
            }
            await this.world.toast(connected);
            out += `<div>You toasted ${this.formatName(thing)}`;
            if (connected.size > 1) {
                const num = connected.size - 1;
                out += ` and everything it was connected to (${num} other object${num === 1 ? '' : 's'})`;
            }
            out += '<\div>';
        }
        this.output(out);
    }
    async atExpr(cmdInfo, thingStr, property, expr) {
        checkArgs(cmdInfo, arguments);
        const [thing, lowerProp, realProp, val] = await this.thingProps(thingStr, property, '0', cmdInfo);
        if (!thing)
            return;
        if (addableProperties.has(realProp))
            return this.error(`Cannot set ${property}`);
        const [value, rest] = await this.computeExpr(exprTokens(splitIf(dropArgs(3, cmdInfo))));
        if (rest.length) {
            throw new Error(`Extra text after condition: ${rest.join(' ')}`);
        }
        if (realProp in thing) {
            const old = thing[realProp];
            if (typeof old !== typeof value) {
                return this.error(`${property} is a ${typeof old}, not a ${typeof value}`);
            }
        }
        if (realProp === '_fullName') {
            thing.markDirty(thing.fullName = value);
        }
        else {
            thing.markDirty(thing[realProp] = value);
        }
        this.output(`You set ${thingStr} ${property} to ${value}`);
    }
    // COMMAND
    atIf(cmdInfo) {
        return this.runIfs(splitIf(cmdInfo.line));
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
        this.checkTicker(thing);
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
        const hall = this.world.hallOfPrototypes;
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
clock rate: ${this.world.clockRate}
the clock is ${this.stopClock ? 'stopped' : 'running'}
there ${this.tickers.size === 1 ? 'is 1 ticker' : 'are ' + this.tickers.size + ' tickers'}

Prototypes:
${protos.join('<br>  ')}
</pre>`);
    }
    // COMMAND
    async atPrototypes() {
        const hall = this.world.hallOfPrototypes;
        this.output(`Prototypes:<br><br>${(await hall.getContents()).map(t => this.dumpName(t)).join('<br>')}`);
    }
    // COMMAND
    help(cmdInfo, cmd) {
        let cmds = [...this.commands.keys()].filter(k => !this.commands.get(k).admin || this.admin);
        let result = '';
        let argLen = 0;
        if (!this.thing) {
            cmds = ['help', 'login'];
        }
        if (cmd && cmds.indexOf(cmd) === -1) {
            return this.error(`Command not found: ${cmd}`);
        }
        for (const name of cmds) {
            const help = this.commands.get(name).help;
            for (let i = 0; i < help.length; i += 2) {
                argLen = Math.max(argLen, name.length + 1 + help[i].length);
            }
        }
        if (cmd) {
            if (this.commands.has(cmd.toLowerCase())) {
                const command = this.commands.get(cmd.toLowerCase());
                const name = command.name;
                const help = command.help;
                for (let i = 0; i < help.length; i += 2) {
                    argLen = Math.max(argLen, name.length + 1 + help[i].length);
                }
                return this.output(`<pre>${helpText(argLen, command)}</pre>`);
            }
        }
        cmds.sort();
        for (const name of cmds) {
            const command = this.commands.get(name);
            if (command.alt)
                continue;
            if (result)
                result += '\n';
            result += helpText(argLen, command);
        }
        this.output('<pre>' + result + `

You can use <b>me</b> for yourself, <b>here</b> for your location, and <b>out</b> for your location's location (if you're in a container)${this.admin ? adminHelp : ''}</pre>`);
    }
}
MudConnection.prototype.commands = initCommands(commands);
function exprTokens(cond) {
    const tokens = [];
    for (const part of cond) {
        if (part[0] === '"' || part[0] === "'") {
            tokens.push(part);
        }
        else {
            tokens.push(...part.split(/(\(|\)|\s+|<|<=|==|>=|>|\+|-|!|&&|\|\|)/).filter(x => x.trim()));
        }
    }
    return tokens;
}
function findCommands(toks) {
    const lines = [];
    let curLine = [];
    let nesting = 0;
    for (const tok of toks) {
        if (tok.toLowerCase() === '@if') {
            nesting++;
        }
        else if (tok.toLowerCase() === '@end') {
            nesting--;
        }
        // only statements at the top level of this context are different commands
        if (nesting === 0) {
            const lineChunks = tok.split(';');
            for (let i = 0; i < lineChunks.length; i++) {
                if (i > 0) {
                    lines.push(curLine.join(' ').trim());
                    curLine = [];
                }
                curLine.push(lineChunks[i]);
            }
        }
        else {
            curLine.push(tok);
        }
    }
    if (curLine.length) {
        lines.push(curLine.join(' ').trim());
    }
    return lines;
}
function splitQuotedWords(line) {
    const chunks = [];
    for (const part of line.split(quotePat).filter(x => x)) {
        if (part[0] === '"' || part[0] === "'") {
            chunks.push(part);
        }
        else {
            chunks.push(...part.split(/\s+/));
        }
    }
    return chunks.filter(x => x); // discard empty strings
}
function splitIf(line) {
    const chunks = [];
    for (const part of line.split(quotePat).filter(x => x)) {
        if (part[0] === '"' || part[0] === "'") {
            chunks.push(part);
        }
        else {
            chunks.push(...part.split(ifPat));
        }
    }
    return chunks.filter(x => x); // discard empty strings
}
function findIfClauses(toks) {
    let nesting = 0;
    let start = 0;
    const clauses = [];
    let i = 0;
    let foundThen = false;
    let foundElse = false;
    for (; i < toks.length; i++) {
        if (nesting === 0 && toks[i].toLowerCase().match(/^(@then|@else|@elseif|@end)$/)) {
            if (toks[i].toLowerCase() === '@then') {
                if (foundThen)
                    throw new Error(`More than one @then: ${toks.join(' ')}`);
                foundThen = true;
            }
            else if (toks[i].toLowerCase() !== '@then' && !foundThen) {
                if (clauses.length)
                    throw new Error(`@if requires a @then: ${toks.join(' ')}`);
            }
            else if (toks[i].toLowerCase() === '@else') {
                if (foundElse)
                    throw new Error(`More than one @else: ${toks.join(' ')}`);
                foundElse = true;
            }
            else if (toks[i].toLowerCase() === '@elseif') {
                if (foundElse)
                    throw new Error(`@elseif should not be after @else: ${toks.join(' ')}`);
                foundThen = false;
            }
            clauses.push(toks.slice(start, i));
            start = i + 1;
            if (toks[i].toLowerCase() === '@end')
                break;
        }
        else if (toks[i].toLowerCase() === '@if') {
            if (nesting === 0 && !foundThen)
                throw new Error(`More than one @if: ${toks.join(' ')}`);
            nesting++;
        }
        else if (nesting > 0 && toks[i].toLowerCase() === '@end') {
            nesting--;
        }
    }
    if (start < i) { // no @end for @if
        clauses.push(toks.slice(start, i));
    }
    else if (start < toks.length) {
        throw new Error(`Extra text after @end: ${toks.slice(start)}`);
    }
    else if (clauses.length < 2) {
        throw new Error('@if requires @then');
    }
    return clauses;
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
        return {
            me: tmp.forme,
            others: tmp.forothers,
        };
    }
    return { others: contexts[0], me: contexts[0] };
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
        await connection.command(text, false, true);
    }
    else if (peerTracker.value !== PeerState.disconnected && mudTracker.value === MudState.Playing) {
        mudproto.command(text);
    }
}
export async function runMud(world, handleOutput) {
    activeWorld = world;
    world.mudConnectionConstructor = MudConnection;
    connection = createConnection(world, handleOutput);
    console.log(connection);
    await connection.start();
    if (world.defaultUser) {
        const user = world.defaultUser;
        if (user) {
            await connection.doLogin(user, null, user, true);
        }
    }
}
export function quit() {
    // tslint:disable-next-line:no-floating-promises
    connection?.close();
    connection = null;
}
export function removeRemotes() {
    for (const [thing, con] of connectionMap) {
        if (con.remote) {
            connectionMap.delete(thing);
        }
    }
}
export function myThing() {
    return connection?.thing;
}
export async function updateUser(user) {
    if (user.thing && connection) {
        const thing = await connection.world.getThing(user.thing);
        const con = connectionMap.get(thing);
        if (con)
            con.admin = user.admin;
    }
}
export function spliceConnection(mudconnectionConstructor) {
    const proto = activeWorld.mudConnectionConstructor.prototype;
    mudconnectionConstructor.prototype.__proto__ = proto;
    if (mudconnectionConstructor.prototype.hasOwnProperty('commands')) {
        const cmds = mudconnectionConstructor.prototype.commands;
        for (const [name, cmd] of activeWorld.mudConnectionConstructor.prototype.commands) {
            cmds.set(name, cmd);
        }
    }
    activeWorld.mudConnectionConstructor = mudconnectionConstructor;
    connection.__proto__ = mudconnectionConstructor.prototype;
}
export function createConnection(world, outputHandler, remote = false) {
    const con = new activeWorld.mudConnectionConstructor();
    con.init(world, outputHandler, remote);
    return con;
}
//# sourceMappingURL=mudcontrol.js.map