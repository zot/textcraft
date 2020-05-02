import { MudState, RoleState, PeerState, mudTracker, roleTracker, peerTracker, } from './base.js';
import { Thing, findSimpleName, escape, idFor, } from './model.js';
import * as mudproto from './mudproto.js';
export let connection;
const connectionMap = new Map();
export let activeWorld;
const wordAndQuotePat = /("(?:[^"\\]|\\.)*")|\s+/;
const reservedProperties = new Set([
    '_id',
    '_prototype',
    '_contents',
    '__proto__',
]);
const addableProperties = new Set([
    '_keys',
]);
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
You can use <b>%NAME</b> as a synonym of NAME for convenience, this helps when using %thing as a command

To make something into a prototype, move it to <b>%protos</b>

FORMAT WORDS:
  <b>\$quote</b>       -- turn off formatting for the rest of the text
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
  <b>\$admin ....</b>  -- If the user is an admin, use everything after $admin instead


COMMAND TEMPLATES:

Command templates are string properties on objects to implement custom commands.
Example command template properties are get_key, cmd, and cmd_whistle -- see the help for @set.
Templates replace the original command with different commands, separated by semicolons.
Templates can contain $0..$N to refer to the command arguments. $0 refers to the command name.
$* refers to all the words after the command name.


EVENTS:

When a thing executes a command, it emits an event which propagates to nearby things. Objects can react
to a type of event by creating a command template called react_EVENT or a method called react_EVENT.
In either case, the reaction takes an argument for the emmiter and each of the event's parameters.
Events have properties which you can access in command templates with %event.PROPERTY and in format
strings with $event.PROPERTY. In methods, this.event refers to the current event.

Example, this will make a box react to people arriving in its location:

@method box react_go (thing, oldLoc, newLoc) this.thing.isIn(newLoc) && cmd('say Hello %event.source!')


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
    ['inv', new Command({ help: [''], alt: 'inventory' })],
    ['invent', new Command({ help: [''], alt: 'inventory' })],
    ['inventory', new Command({ help: ['', `list what you are carrying`] })],
    ['say', new Command({
            help: ['words...', `Say something
   You can use ' or " as a synonym for say if it's the first character of a command
`]
        })],
    ['@say', new Command({ help: ['"words..." arg...', `Formatted say`] })],
    ['whisper', new Command({ help: ['thing words...', `Say something to thing`] })],
    ['act', new Command({
            help: ['words...', `Do something
   You can use : as a synonym for act if it's the first character of a command
`]
        })],
    ['gesture', new Command({ help: ['thing words...', `Do something towards thing`] })],
    ['get', new Command({
            help: ['thing', `grab a thing`, 'thing [from] location', `grab a thing from a location`]
        })],
    ['drop', new Command({ help: ['thing', `drop something you are carrying`] })],
    ['@call', new Command({ help: ['thing.property arg...', `Call a method on a thing`] })],
    ['@js', new Command({
            help: ['var1 = thing1, var2 = thing2... ; code...', `Run JavaScript code with optional variable bindings
   Note that commas between variable bindings are optional
   The initial variable values are things looked up by name and bound to specProxies for the things
   You can use ! as a synonym for @js if it's the first character of a command

   The following are predefined for convenience:
     me                        specProxy for your thing
     here                      specProxy for your location
     event                     the current event (if there is one)
     inAny(property, item)     returns whether anything nearby has item in property
                               Synonym for anyHas(findNearby(), property, item)
     anyHas(things, property)
     anyHas(things, property, item)
                               returns whether any of things is associated with item (defaults to 'me')
     findNearby()
     findNearby(thing)         PROMISE for nearby items (thing defaults to your thing)
     cmd(item, ...)            creates a command context
     cmdf(FORMAT, arg, ...)    creates a command context
     doThings(thing..., func)  find things and call func

   CommandContexts also support methods cmd() and cmdf() to allow chaining
   If you return a command context, the system will run it

   FOUR TYPES OF PROXIES

   SPEC PROXY
   Arguments to @js and @call are bound to specProxies, not to things. Spec proxies make it convienient
   to access its persisted properties, so value.name accesses thing._name in the value's thing. You can
   use vlaue._thing to get the real thing. Both spec proxies and their things support the other three
   types of proxies, below.

   ASSOC/ASSOCMANY PROXY !!! USES PROMISES !!!
   thing.assoc lets you access associations with other things by using promises. This means you need
   to AWAIT values. For example, to get a thing's location, you can say await thing.assoc.location.
   @dump will list all of a thing's associations and also everything associated with it. You can use
   thing.assocMany to get array results even if there is only one association a property.

   ASSOCID/ASSOCIDMANY PROXY
   thing.assocId lets you access associations by THING ID and does not use promises, so you don't need
   to use await. This means thing.assocId.location returns a NUMBER, NOT A THING. This means you need
   to AWAIT values, like with assoc proxies. You can use thing.assocIdMany to get array results even if
   there is only one association a property.

   REFS PROXY !!! USES PROMISES !!!
   thing.refs lets you access things associated with a thing by using promises. For example,
   thing.refs.location will return an array of everything located in thing.
`]
        })],
    ['@method', new Command({
            help: ['thing name (args...) body', `Define a method on a thing
   The method actually runs in the context of the thing's MudConnection, not the thing itself
   @call calls the method with specProxies for whatever arguments it provides. See @js for details.
`]
        })],
    ['@dump', new Command({
            help: ['thing', `See properties of a thing
   You can use % as a synonym for @dump if it's the first character of a command
`]
        })],
    ['@commands', new Command({ help: ['thing', `Print commands to recreate a thing`] })],
    ['@move', new Command({ help: ['thing location', 'Move a thing'] })],
    ['@fail', new Command({
            help: ['context format args', `Fail the current event and emit a format string
   If it has $forme, it will output to the user, if it has $forothers, that will output to others`]
        })],
    ['@output', new Command({
            help: ['contextThing FORMAT-AND-EVENT-ARGS...',
                ` Output text to the user and/or others using a format string on contextThing
  @output contextThing "FORMAT" arg... @event actor EVENT arg...
  @output contextThing "FORMAT" arg... @event actor false EVENT arg...

  if the format is for others, @output will emit a descripton using information after @event
  actor specifies who emits the descripton.
  Adding false before EVENT indicates that the event failed.`]
        })],
    ['@mute', new Command({ help: ['', 'temporarily silence all output commands that are not yours'] })],
    ['@unmute', new Command({ help: ['', 'enable output from other commands'] })],
    ['@quiet', new Command({ help: ['', 'disable all output for this command'] })],
    ['@loud', new Command({ help: ['', 'enable all output for this command'] })],
    ['@admin', new Command({ help: ['thing boolean', 'Change a thing\'s admin privileges'] })],
    ['@create', new Command({
            help: ['proto name [description words...]', `Create a thing using a prototype.
   You can use a prototype by name if it's in the hall of prototypes or you can specify any other
   thing using %-notation. The known prototypes in the hall of prototypes are:
$prototypes`]
        })],
    ['@patch', new Command({ help: ['subject viewer', 'Patch subject for a viewer'] })],
    ['@toast', new Command({ help: ['thing...', 'Toast things and everything they\'re connected to'] })],
    ['@copy', new Command({
            help: ['thing', '',
                'thing force', `Copy a thing to your inventory (force allows copying the entire world -- can be dangerous)`]
        })],
    ['@find', new Command({
            help: ['thing', 'Find a thing from your current location',
                'thing start', 'Find a thing from a particular thing',]
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
    ['@setnum', new Command({ help: ['thing property number'], admin: true, alt: '@set' })],
    ['@setbigint', new Command({ help: ['thing property bigint'], admin: true, alt: '@set' })],
    ['@setbool', new Command({ help: ['thing property boolean'], admin: true, alt: '@set' })],
    ['@set', new Command({ help: setHelp })],
    ['@continue', new Command({ help: ['', 'Continue substitution'] })],
    ['@script', new Command({
            help: ['commands', `Commands is a set of optionally indented lines.
  Indentation indicates that a line belongs to the unindented command above it`]
        })],
    ['@assoc', new Command({ help: ['thing property thing', `Associate a thing with another thing`] })],
    ['@assocmany', new Command({
            help: ['thing property thing', `Associate a thing with another thing
   Allows many associations of the same type`]
        })],
    ['@delassoc', new Command({ help: ['thing property', '', 'thing property thing', `Dissociate a thing from another thing or from all things`] })],
    ['@del', new Command({ help: ['thing property', `Delete a properties from a thing so it will inherit from its prototype`] })],
    ['@reproto', new Command({ help: ['thing proto', `Change the prototype of a thing`] })],
    ['@instances', new Command({ help: ['proto', `Display all instances`] })],
    ['@bluepill', new Command({
            help: [
                '', '',
                'thing', `Turn off verbose names for thing (or yourself if there is no argument`
            ]
        })],
    ['@redpill', new Command({
            help: [
                '', '',
                'thing', `Turn on verbose names for thing (or yourself if there is no argument`
            ]
        })],
    ['@delay', new Command({ help: ['command...', `Delay a command until after the current ones finish`] })],
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
    constructor(source, event, args, failed) {
        this.succeedHooks = [];
        this.failHooks = [];
        this.connection = connectionMap.get(source) || connection;
        this.tick = connection.tickCount;
        this.source = source;
        this.event = event;
        this.failed = failed;
        this.args = args;
        for (let i = 0; i < args.length; i++) {
            this[i] = args[i];
        }
    }
    copy() {
        return { __proto__: this };
    }
    get actor() { return this.source; }
    emit(thing, visitFunc, excludes, visitLinks = false) {
        excludes = excludes ? pxyThings(excludes) : [thing._thing, thing._thing.world.limbo];
        this.propagate(thing._thing, new Set(excludes), visitFunc, visitLinks);
    }
    props(thing) {
        return this.connection.props(thing);
    }
    /**
     * Propagate to a thing and its contents
     * If the thing is open, also propagate to its location
     * If this.visitLinks is true, also propagate through links
     */
    propagate(thing, visited, visitFunc, visitLinks) {
        if (this.done || !thing || visited.has(thing))
            return;
        visited.add(thing);
        visitFunc(thing, this);
        for (const item of thing.refs.location) {
            this.propagate(item, visited, visitFunc, visitLinks);
        }
        if (visitLinks) {
            for (const item of thing.refs.linkOwner) {
                const otherLink = thing.assoc.otherLink;
                const otherThing = otherLink && otherLink.assoc.linkOwner;
                this.propagate(otherLink, visited, visitFunc, visitLinks);
                this.propagate(otherThing, visited, visitFunc, visitLinks);
            }
        }
        if (!this.props(thing)._closed || this.ignoreClosed)
            return this.propagate(thing.assoc.location, visited, visitFunc, visitLinks);
    }
    wrapThings() {
        this.source = this.source?.specProxy;
    }
    unwrapThings() {
        this.source = this.source?._thing;
    }
    sendOutput(start, formatString, args, prefix, context = start) {
        const prefixStr = prefix ? capitalize(this.connection.formatName(this.actor._thing)) + ' ' : '';
        this.emit(start, t => {
            const con = connectionMap.get(t);
            if (con) {
                con.withResults(connection, () => {
                    // run format in each connection so it can deal with admin, names, etc.
                    con.output(prefixStr + con.basicFormat(context, formatString, args));
                });
            }
            else {
                // process reactions in the main MudConnection
                connection.react(t, this);
            }
        }, [this.actor._thing]);
    }
    emitFail(start, failFormat, args = [], prefix, context = start) {
        const prefixStr = prefix ? capitalize(this.connection.formatName(this.actor._thing)) + ' ' : '';
        const contexts = formatContexts(failFormat);
        let con = this.connection;
        const msg = contexts.me && con.basicFormat(con.thing, contexts.me, args);
        this.fail();
        if (contexts.others) {
            this.emit(start._thing, t => {
                con = connectionMap.get(t);
                if (con) {
                    con.withResults(connection, () => {
                        // run format in each connection so it can deal with admin, names, etc.
                        con.output(prefixStr + con.basicFormat(context, contexts.others, args));
                    });
                }
                else {
                    // process reactions in the main MudConnection
                    connection.react(t, this);
                }
            }, [this.actor._thing]);
        }
        return new Error(msg);
    }
    fail() {
        if (!this.failed) {
            this.failed = true;
            for (const code of this.failHooks) {
                code();
            }
        }
    }
}
class MoveDescripton extends Descripton {
    constructor(actor, evt, thing, dest, dir, dirStr) {
        super(actor, evt, [], false);
        this.thing = thing?._thing;
        this.origin = thing.assoc.location?._thing;
        this.destination = dest?._thing;
        this.direction = dir?._thing;
        this.directionString = dirStr;
        this.wrapThings();
    }
    wrapThings() {
        super.wrapThings();
        this.thing = this.thing?.specProxy;
        this.origin = this.origin?.specProxy;
        this.destination = this.destination?.specProxy;
        this.direction = this.direction?.specProxy;
    }
    unwrapThings() {
        super.unwrapThings();
        this.thing = this.thing?._thing;
        this.origin = this.origin?._thing;
        this.destination = this.destination?._thing;
        this.direction = this.direction?._thing;
    }
    sendOutputs() {
        this.unwrapThings();
        const copy = this.copy();
        const args = [this.thing, this.origin, this.destination];
        const con = this.connection;
        const link = this.props(this.direction?.assoc.otherLink?._thing);
        const outOf = this.origin.assoc.location._thing === this.destination;
        const into = this.destination.assoc.location._thing === this.origin;
        copy.wrapThings();
        if (!this.moveFormat) {
            if (this.direction && this.direction !== this.destination) {
                this.moveFormat = this.props(this.direction)._linkMoveFormat;
            }
            else if (outOf) {
                this.moveFormat = `You get out of $arg2 into $arg3`;
            }
            else if (into) {
                this.moveFormat = `You get into $arg3 from $arg2`;
            }
            else {
                this.moveFormat = `You go from $arg2 to $arg3`;
            }
        }
        if (!this.exitFormat) {
            this.exitFormat = this.props(this.direction)?._linkExitFormat
                || this.origin._exitFormat
                || (outOf && `$event.thing gets out of $arg2 into $arg3`)
                || (into && `$event.thing gets into $arg3 from $arg2`)
                || `$event.thing goes from $arg2 to $arg3`;
        }
        if (!this.enterFormat) {
            this.enterFormat = link?._linkEnterFormat
                || this.props(this.destination)._enterFormat
                || (outOf && `$event.thing gets out of $arg2 into $arg3`)
                || (into && `$event.thing gets into $arg3 from $arg2`)
                || `$event.thing goes from $arg2 to $arg3`;
        }
        this.moveFormat = formatContexts(this.moveFormat).me;
        this.exitFormat = formatContexts(this.exitFormat).others;
        this.enterFormat = formatContexts(this.enterFormat).others;
        this.moveFormat && con?.output(con.basicFormat(this.direction || this.origin, this.moveFormat, args));
        this.exitFormat && copy.sendOutput(this.origin, this.exitFormat, args, false, this.direction || this.origin);
        this.enterFormat && copy.sendOutput(this.destination, this.enterFormat, args, false, this.direction?.assoc.otherLink || this.destination);
    }
}
class CommandContext {
    constructor(con) {
        this.executed = false;
        this.connection = con;
        this.commands = [];
    }
    cmd(...stringsAndThings) {
        let command = '';
        for (const item of stringsAndThings) {
            if (item instanceof Thing) {
                command += ' %' + item.id;
            }
            else {
                command += item;
            }
        }
        this.commands.push(command);
        return this;
    }
    cmdf(str, ...args) {
        const chunks = str.split(/(\\\$|\$[0-9]+(?:\.[a-zA-Z0-9_]+)?)/);
        const things = args.map(item => this.findThing(item));
        let command = '';
        for (const chunk of chunks) {
            if (chunk[0] === '$') {
                const [, num, prop] = chunk.match(/^\$([0-9]+)(?:\.([a-zA-Z0-9_]+))?$/);
                let value = things[num];
                if (prop) {
                    value = value[prop];
                }
                if (value instanceof Thing) {
                    command += ` %${value.id} `;
                }
                else {
                    command += value;
                }
            }
            else {
                command += chunk;
            }
        }
        this.commands.push(command);
        return this;
    }
    run() {
        if (!this.executed) {
            this.executed = true;
            return this.connection.runCommands(this.commands);
        }
    }
    findThing(item) {
        if (item instanceof Thing) {
            return item;
        }
        else if (typeof item === 'string') {
            return this.connection.find(item);
        }
        else if (Array.isArray(item)) {
            return this.connection.find(item[0], pxyThing(item[1]), item[2]);
        }
        else {
            throw new Error(`Could not find ${item}`);
        }
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
        const con = this;
        this.pending = [];
        this.patchCounts = new Map();
        this.patches = new Map();
    }
    cmd(...items) {
        return new CommandContext(this).cmd(...items);
    }
    cmdf(format, ...items) {
        return new CommandContext(this).cmdf(format, ...items);
    }
    init(world, outputHandler, remote = false) {
        this.world = world;
        this.outputHandler = outputHandler;
        this.remote = remote;
    }
    async close() {
        if (this.thing) {
            this.thing.assoc.location = this.thing.world.limbo;
        }
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
        this.failed = true;
        this.output('<div class="error">' + text + '</div>');
        this.suppressOutput = oldSup;
    }
    errorNoThing(thing) {
        this.error(`You don't see any ${thing} here`);
    }
    output(text) {
        if ((!this.suppressOutput && this.muted < 1) || this.failed) {
            this.outputHandler(text.match(/^</) ? text : `<div>${text}</div>`);
        }
    }
    withResults(otherCon, func) {
        if (otherCon) {
            const oldEvent = this.event;
            const oldCondition = this.conditionResult;
            this.event = otherCon.event;
            this.conditionResult = otherCon.conditionResult;
            try {
                func();
            }
            finally {
                this.event = oldEvent;
                this.conditionResult = oldCondition;
            }
        }
        else {
            func();
        }
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
    props(thing) {
        if (!thing)
            return thing;
        if (this.patchCounts.get(thing) === this.world.count) {
            return this.patches.get(thing);
        }
        const patch = this.findPatch(thing);
        this.patchCounts.set(thing, this.world.count);
        this.patches.set(thing, patch);
        return patch;
    }
    findPatch(thing) {
        for (const patch of thing.refs.patch) {
            if (patch.assocId.patchFor === this.thing.id) {
                return patch;
            }
        }
        return thing;
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
    dumpName(tip, simpleName) {
        const thing = this.world.getThing(tip);
        return thing ? this.formatName(thing, true, true, simpleName) : 'null';
    }
    formatName(thing, esc = false, verbose = this.verboseNames, simpleName) {
        let output = simpleName ? thing._thing._name : thing._thing.formatName();
        if (esc)
            output = escape(output);
        if (verbose) {
            output += `<span class='thing'>(%${thing.id})</span>`;
        }
        return output;
    }
    formatDumpProperty(thing, prop, noParens = false) {
        const inherited = !(noParens || thing.hasOwnProperty('_' + prop));
        return `<span class='property${inherited ? ' inherited' : ''}'><span class='hidden input-text'>@set %${thing.id} ${prop} <span class='select'>${escape(thing['_' + prop])}</span></span>${prop}</span>`;
    }
    formatDumpMethod(thing, prop, noParens = false) {
        const inherited = !(noParens || thing.hasOwnProperty('!' + prop));
        const [args, body] = JSON.parse(thing['!' + prop]._code);
        return `<span class='method${inherited ? ' inherited' : ''}'><span class='hidden input-text'>@method %${thing.id} ${prop} <span class='select'>${escape(args)} ${escape(body)}</span></span>${prop}</span>`;
    }
    basicFormat(tip, str, args) {
        if (!str)
            return str;
        const thing = tip instanceof Thing ? tip._thing : this.world.getThing(tip);
        const adminParts = str.split(/(\s*\$admin\b\s*)/i);
        str = adminParts.length > 1 ? (this.admin && adminParts[2]) || adminParts[0] : str;
        const parts = str.split(/( *\$(?:result|event)(?:\.\w*)?| *\$\w*)/i);
        let result = '';
        let enabled = true;
        for (const part of parts) {
            const match = part.match(/^( *)\$(.*)$/);
            if (match && enabled) {
                const [_, space, format] = match;
                const argMatch = format.toLowerCase().match(/arg([0-9]*)/);
                if (format === 'quote') {
                    enabled = false;
                    continue;
                }
                result += space;
                if (argMatch) {
                    const arg = args[argMatch[1] ? Number(argMatch[1]) - 1 : 0];
                    result += capitalize(this.formatName(arg), format);
                    continue;
                }
                else if (format.match(/^result(?:\.\w+)?$/i)) {
                    const t = this.getResult(format, this.conditionResult);
                    result += capitalize(t instanceof Thing ? this.formatName(t) : t, format);
                    continue;
                }
                else if (format.match(/^event(?:\.\w+)?$/i)) {
                    const t = this.getResult(format, this.event);
                    result += capitalize(t instanceof Thing ? this.formatName(t) : t, format);
                    continue;
                }
                switch (format.toLowerCase()) {
                    case 'prototypes': {
                        const ind = '\n      ';
                        result += ind + this.world.hallOfPrototypes.refs.location.map(t => this.dumpName(t, true)).join(ind);
                        continue;
                    }
                    case 'this': {
                        let name;
                        if (thing === this.thing) {
                            name = 'you';
                        }
                        else {
                            name = this.formatName(this.props(thing));
                        }
                        result += capitalize(name, format);
                        continue;
                    }
                    case 'name': {
                        result += this.props(thing).name;
                        continue;
                    }
                    case 'is': {
                        result += this.isPlural(this.props(thing)) ? 'are' : 'is';
                        continue;
                    }
                    case 's': {
                        if (!this.isPlural(this.props(thing))) {
                            result += (result.match(/\sgo$/) ? 'es' : 's');
                        }
                        continue;
                    }
                    case 'location': {
                        result += capitalize(this.formatName(this.props(thing.assoc.location?._thing)), format);
                        continue;
                    }
                    case 'owner': {
                        result += capitalize(this.formatName(this.props(thing.assoc.linkOwner?._thing)), format);
                        continue;
                    }
                    case 'link': {
                        const other = thing.assoc.otherLink?._thing;
                        const dest = other?.assoc.linkOwner?._thing;
                        if (dest) {
                            result += capitalize(this.formatName(this.props(dest)), format);
                        }
                        continue;
                    }
                    case 'contents': {
                        const contents = thing.refs.location;
                        const hidden = this.hiddenFor(this.thing);
                        if (contents.length) {
                            for (const item of contents) {
                                if ((!item.assoc.visibleTo || item.assoc.visibleTo === this.thing)
                                    && !hidden.has(item)) {
                                    result += `<br>&nbsp;&nbsp;${this.format(item, this.props(thing).contentsFormat)}`;
                                }
                            }
                            result += '<br>';
                        }
                        continue;
                    }
                    case 'links': {
                        const links = thing.refs.linkOwner;
                        if (links.length) {
                            for (const item of links) {
                                result += `<br>&nbsp;&nbsp;${this.format(item, this.props(item).linkFormat)}`;
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
    hiddenFor(thing) {
        const items = [];
        const fooling = thing.refs.fooling;
        for (const item of fooling) {
            items.push(...item.assocMany.hides);
        }
        return new Set(items);
    }
    description(thing) {
        return this.format(thing, this.props(thing).description);
    }
    examination(thing) {
        const result = this.description(thing);
        const format = this.props(thing).examineFormat;
        return result + (format ? `<br>${this.format(thing, format)}` : '');
    }
    describe(thing) {
        this.output(this.description(thing));
    }
    checkCommand(prefix, cmd, thing, checkLocal = cmd === thing.name) {
        return (checkLocal && (thing['_' + prefix] || thing['!' + prefix]))
            || (cmd && (thing[`_${prefix}_${cmd}`] || thing[`!${prefix}_${cmd}`]));
    }
    findCommand(words, prefix = 'cmd') {
        const result = this.findTemplate(words, prefix);
        if (result) {
            const [context, template] = result;
            return this.substituteCommand(template, [`%${context.id}`, ...words]);
        }
    }
    findTemplate(words, prefix) {
        const cmd = words[0].toLowerCase();
        let template;
        for (const item of (this.thing.refs.location)) {
            template = this.checkCommand(prefix, cmd, this.props(item));
            if (template) {
                return [item, template];
            }
        }
        if (!template) {
            for (const item of (this.thing.refs.linkOwner)) {
                template = this.checkCommand(prefix, cmd, this.props(item));
                if (template) {
                    return [item, template];
                }
            }
        }
        if (!template) {
            const loc = this.thing.assoc.location?._thing;
            template = this.checkCommand(prefix, cmd, this.props(loc));
            if (template) {
                return [loc, template];
            }
            else {
                for (const item of (loc.refs.linkOwner)) {
                    template = this.checkCommand(prefix, cmd, this.props(item));
                    if (template) {
                        return [item, template];
                    }
                }
            }
        }
    }
    substituteCommand(template, args) {
        if (typeof template === 'string') {
            const lines = [];
            const words = args.map(a => a instanceof Thing ? `%${a.id}` : a);
            for (const line of template.split(/\n/)) {
                const parts = line.split(/( *\$(?:\w+|\*))/);
                let newCmd = '';
                for (const part of parts) {
                    const match = part.match(/^( *)\$(.*)$/);
                    if (match) {
                        const [_, space, format] = match;
                        newCmd += space;
                        if (format === '*') {
                            newCmd += words.slice(1).join(' ');
                        }
                        else {
                            newCmd += words[Number(format)];
                        }
                    }
                    else {
                        newCmd += part;
                    }
                }
                lines.push(newCmd.trim());
            }
            return lines.length > 0 ? lines : null;
        }
        else if (template instanceof Function) {
            const things = [];
            this.substituting = true;
            for (const item of args) {
                if (item instanceof Thing) {
                    things.push(thingPxy(item));
                }
                else {
                    things.push(thingPxy(this.find(item, undefined, 'thing', true)));
                }
            }
            const result = template.apply(this, things);
            return result instanceof CommandContext ? [result] : [];
        }
    }
    runCommands(lines) {
        const oldSubstituting = this.substituting;
        try {
            this.substituting = true;
            if (Array.isArray(lines)) {
                for (const line of lines) {
                    if (line instanceof CommandContext) {
                        line.run();
                    }
                    else {
                        this.command(line, true);
                    }
                    if (this.failed)
                        break;
                }
            }
            else if (lines instanceof Function) {
                return lines();
            }
        }
        finally {
            this.substituting = oldSubstituting;
        }
    }
    // execute toplevel commands inside transactions so they will automatically store any dirty objects
    async toplevelCommand(line, user = false) {
        await this.world.doTransaction(async () => {
            if (this.command(line, false, user)) {
                if (this.pending.length) {
                    const promise = Promise.all(this.pending);
                    this.pending = [];
                    await promise;
                }
            }
        })
            .catch(err => {
            console.log(err);
            this.error(err.message);
        })
            .finally(() => {
            this.failed = false;
            this.substituting = false;
        });
        if (this.thing?.name !== this.myName) {
            this.myName = this.thing.name;
            mudproto.userThingChanged(this.thing);
        }
    }
    command(line, substituted = false, user = false) {
        const originalLine = line;
        if (!line.trim())
            return;
        if (line[0] === '"' || line[0] === "'") {
            line = `say ${line.substring(1)}`;
        }
        else if (line[0] === ':') {
            line = `act ${line.substring(1)}`;
        }
        else if (line[0] === '%' && this.admin) {
            line = `@dump ${line}`;
        }
        else if (line[0] === '!') {
            line = `@js ${line.substring(1)}`;
        }
        const words = splitQuotedWords(line);
        let commandName = words[0].toLowerCase();
        if (!substituted) {
            this.output('<div class="input">&gt; <span class="input-text">' + escape(originalLine) + '</span></div>');
            if (!this.commands.has(commandName) && this.thing) {
                const newCommands = this.findCommand(words);
                if (newCommands)
                    return this.runCommands(newCommands);
                const target = this.find(words[0], this.thing.assoc.location);
                if (target) {
                    line = `go ${line}`;
                    words.unshift('go');
                    commandName = 'go';
                }
            }
        }
        if (this.thing ? this.commands.has(commandName) : commandName === 'login' || commandName === 'help') {
            let command = this.commands.get(commandName);
            if (command.alt)
                command = this.commands.get(command.alt);
            if (command?.admin && !this.admin && !substituted) {
                return this.error('Unknown command: ' + words[0]);
            }
            const muted = this.muted;
            if (!substituted && user)
                this.muted = 0;
            try {
                this.update(() => this[command.method]({ command, line, substituted }, ...words.slice(1)));
                return true;
            }
            finally {
                if (this.muted === 0)
                    this.muted = muted;
                if (!substituted)
                    this.suppressOutput = false;
            }
        }
        else {
            this.error('Unknown command: ' + words[0]);
        }
    }
    update(func) {
        return this.world.update(func);
    }
    findAll(names, start = this.thing, errTag = '') {
        const result = [];
        for (const name of names) {
            result.push(this.find(name, start, errTag));
        }
        return result;
    }
    getResult(str, value) {
        const match = str.match(/^[^.]+(?:\.(\w+))?$/);
        return match[1]?.length ? value[match[1]] : value;
    }
    doThings(...items) {
        const func = items[items.length - 1];
        if (typeof func !== 'function') {
            throw new Error('Expected function for with');
        }
        const things = this.findAll(items.slice(0, items.length - 1), undefined, 'thing');
        return func.apply(this, things);
    }
    findThing(name, start = this.thing, errTag = '', subst = false) {
        return this.find(name, start, errTag, subst);
    }
    find(name, start = this.thing, errTag = '', subst = false) {
        let result;
        start = start?._thing;
        if (!name)
            return null;
        name = name.trim().toLowerCase();
        if (name[0] !== '%' || this.admin || this.substituting || subst) {
            if (name === 'out' || name === '%out') {
                const location = this.thing.assoc.location?._thing;
                result = location && location.assoc.location?._thing;
                if (!result || result === this.world.limbo) {
                    throw new Error('You are not in a container');
                }
            }
            else {
                result = name === 'me' || name === '%me' ? this.thing
                    : name === 'here' || name === '%here' ? this.thing.assoc.location?._thing
                        : name === '%limbo' ? this.world.limbo
                            : name === '%lobby' ? this.world.lobby
                                : name === '%protos' ? this.world.hallOfPrototypes
                                    : name.match(/^%result(\.\w+)?$/) ? this.getResult(name, this.conditionResult)
                                        : name.match(/^%event(\.\w+)?$/) ? this.getResult(name, this.event)
                                            : name.match(/^%proto:/) ? this.world.hallOfPrototypes.find(name.replace(/^%proto:/, ''))
                                                : name.match(/%-[0-9]+/) ? this.created[this.created.length - Number(name.substring(2))]
                                                    : name.match(/%[0-9]+/) ? this.world.getThing(Number(name.substring(1)))
                                                        : this.findThingInWorld(start, name);
            }
        }
        result = result?._thing;
        if (!result && errTag)
            throw new Error(`Could not find ${errTag}: ${name}`);
        if (result instanceof Thing) {
            this.world.stamp(result);
        }
        return result;
    }
    findThingInWorld(start, name) {
        const hidden = this.hiddenFor(this.thing);
        if (name[0] === '%')
            name = name.slice(1);
        name = name.toLowerCase();
        return start.find(thing => !hidden.has(thing) && thing.name.toLowerCase() === name, this.thing.isIn(this.world.limbo) ? new Set() : new Set([this.world.limbo]));
    }
    dumpThingNames(things) {
        const items = [];
        for (const item of things) {
            items.push(this.dumpName(item));
        }
        return items.length ? items.join(', ') : 'nothing';
    }
    thingProps(thingStr, property, value, cmd) {
        const thing = this.find(thingStr);
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
        if (typeof value !== 'undefined' && propMap.has(lowerProp)) {
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
            await this.world.doTransaction(async () => {
                const oldThing = this.thing;
                const [thing, admin] = await this.world.authenticate(user, password, name, noauthentication);
                this.user = user;
                this.thing = thing._thing;
                this.myName = thing.name;
                //this.myName = thing.name
                this.admin = admin;
                this.verboseNames = admin;
                connectionMap.set(this.thing, this);
                if (oldThing && oldThing !== this.thing)
                    connectionMap.delete(oldThing);
                this.output(`Connected, you are logged in as ${user}.
<br>You can use the login command to change users...
<br><br>`);
                mudproto.userThingChanged(this.thing);
                thing.assoc.location = this.world.lobby;
                this.commandDescripton(this.thing, 'has arrived', 'go', [this.world.limbo, this.world.lobby]);
                // tslint:disable-next-line:no-floating-promises
                this.look(null, null);
                if (!this.remote) {
                    this.stopClock = false;
                    this.queueTick();
                }
            });
        }
        catch (err) {
            this.error(err.message);
        }
    }
    commandDescripton(context, action, event, args, succeeded = true, prefix = true, excludeActor = true, startAt, actor = this.thing) {
        return this.formatDescripton(context, action, [], event, args, succeeded, prefix, excludeActor, startAt, actor);
    }
    formatDescripton(actionContext, action, actionArgs, event, args, succeeded = true, prefix = true, excludeActor = true, startAt, actor = this.thing) {
        if (!this.suppressOutput) {
            const exclude = [];
            const desc = new Descripton(actor, event, args, !succeeded);
            const visitFunc = thing => {
                const con = connectionMap.get(thing);
                if (con) {
                    con.withResults(this, () => {
                        // run format in each connection so it can deal with admin and names
                        const format = con.basicFormat(actionContext, action, actionArgs);
                        const text = prefix ? `${capitalize(con.formatName(this.thing))} ${format}` : format;
                        con.output(text);
                    });
                }
                else {
                    // process reactions in the main MudConnection
                    connection.react(thing, desc);
                }
            };
            if (!startAt)
                startAt = this.thing.assoc.location?._thing;
            if (excludeActor)
                exclude.push(actor);
            desc.emit(startAt, visitFunc, exclude);
        }
    }
    react(thing, desc) {
        if (this.remote)
            throw new Error(`Attempt to react in a remote connection`);
        const reactPat = new RegExp(`[_!]react_${desc.event.toLowerCase()}`);
        let reacted = false;
        for (const key in thing) {
            if (key.toLowerCase().match(reactPat)) {
                this.doReaction(thing, desc, thing[key]);
                reacted = true;
                break;
            }
        }
        if (!reacted && thing._react) {
            connection.doReaction(thing, desc, thing._react);
        }
    }
    doReaction(thing, desc, reaction) {
        if (this.remote)
            throw new Error(`Attempt to react in a remote connection`);
        if (this.acted.has(thing) && !this.pendingReactions.has(thing)) {
            this.pendingReactions.set(thing, () => this.doReaction(thing, desc, reaction));
            this.queueTick();
        }
        else {
            const con = this.connectionFor(thing);
            con.event = desc;
            con.conditionResult = this.conditionResult;
            this.acted.add(thing);
            con.pending.push(con.runCommands(con.substituteCommand(reaction, [thing, ...desc.args].map(thingPxy))));
        }
    }
    connectionFor(thing) {
        let con = connectionMap.get(thing._thing);
        if (!con) {
            con = new MudConnection(thing);
            con.admin = true;
            con.world = this.world;
            con.remote = true;
            con.event = this.event;
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
                await this.world.doTransaction(async () => {
                    const tick = new Descripton(null, 'tick', [], false);
                    for (const ticker of this.tickers) {
                        const reaction = ticker._react_tick;
                        if (reaction) {
                            tick.source = ticker;
                            this.doReaction(ticker, tick, reaction);
                        }
                    }
                    const promise = Promise.all(this.pending);
                    this.pending = [];
                    await promise;
                });
            }
            if (ticked) {
                this.queueTick(targetTime - Date.now(), true);
            }
            else {
                this.ticking = false;
            }
        }
    }
    hasKey(lock, start) {
        if (start._keys.indexOf(lock.id) !== -1) {
            return true;
        }
        for (const item of start.refs.location) {
            if (item._keys.indexOf(lock.id) !== -1) {
                return true;
            }
        }
        return false;
    }
    anyHas(things, prop, thing = this.thing) {
        return things.find(t => t.assoc.has(prop, pxyThing(thing)));
    }
    findNearby(thing = this.thing) {
        const things = [pxyThing(thing)];
        things.push(...pxyThing(thing).refs.location);
        return things;
    }
    inAny(prop, target, thing = this.thing) {
        return (this.findAny(prop, pxyThing(thing)))?.has(target.id);
    }
    findAny(prop, thing = this.thing) {
        const ids = [];
        thing.assoc.allIdsNamed(prop, ids);
        for (const item of thing.refs.location) {
            item.assoc.allIdsNamed(prop, ids);
        }
        return new Set(ids);
    }
    formatValue(value, visited = new Set()) {
        if (value === null)
            return 'null';
        if (value === undefined)
            return 'undefined';
        if (typeof value !== 'object')
            return JSON.stringify(value);
        if (visited.has(value))
            return 'circularity';
        visited.add(value);
        if (value instanceof Thing)
            return `%${this.formatName(value)}`;
        if (Array.isArray(value)) {
            return `[${value.map(t => this.formatValue(t, visited)).join(', ')}]`;
        }
        else if (typeof value === 'object') {
            return `{${Object.keys(value).map(k => k + ': ' + this.formatValue(value[k], visited)).join(', ')}}`;
        }
        return JSON.stringify(value) || String(value);
    }
    continueMove(cmdInfo, evt) {
        if (evt.failed)
            return;
        if (evt.directionString && !evt.direction) {
            if (this.substituting)
                throw evt.emitFail(this.thing, `Where is ${evt.directionString}?`);
            // e.g. check if there's a go_north property in the room
            this.eventCommand(`${evt.event}_${evt.directionString}`, null, evt.source.assoc.location, evt);
        }
        else if (evt.direction && !this.substituting) {
            this.eventCommand(evt.event, evt.directionString, evt.direction, evt);
        }
        if (evt.failed)
            return;
        if (!evt.destination)
            throw evt.emitFail(this.thing, `Go where?`);
        if (!this.substituting) {
            this.eventCommand(evt.event, evt.directionString, evt.destination, evt);
        }
        if (evt.failed)
            return;
        // nothing prevented it so the thing will actually move now
        this.update(() => evt.thing._thing.assoc.location = evt.destination);
        evt.sendOutputs();
    }
    eventCommand(prefix, suffix, thing, event) {
        this.event = event;
        const cmd = this.checkCommand(prefix, suffix, thing._thing, true);
        if (cmd) {
            const template = this.substituteCommand(cmd, [`%${thing.id}`, ...event.args]);
            this.event = event;
            template && this.runCommands(template);
            this.substituting = false;
        }
    }
    isPlural(thing) {
        const t = thing?._thing;
        return !t || (t._plural || t === this.thing);
    }
    adminName(thing) {
        const w = this.world;
        const id = idFor(thing);
        return id === w.limbo.id ? '%limbo'
            : id === w.lobby.id ? '%lobby'
                : id === w.thingProto.id ? '%proto:thing'
                    : id === w.roomProto.id ? '%proto:room'
                        : id === w.linkProto.id ? '%proto:link'
                            : id === w.personProto.id ? '%proto:person'
                                : id === w.generatorProto.id ? '%proto:generator'
                                    : '%' + id;
    }
    isStd(id) {
        return this.stdIds().indexOf(id) !== -1;
    }
    stdIds() {
        const w = this.world;
        return [
            w.limbo.id,
            w.lobby.id,
            w.thingProto.id,
            w.roomProto.id,
            w.linkProto.id,
            w.hallOfPrototypes.id,
            w.personProto.id,
            w.generatorProto.id
        ];
    }
    // COMMAND
    login(cmdInfo, user, password) {
        setTimeout(() => this.doLogin(user, password, user), 1);
    }
    // COMMAND
    look(cmdInfo, target) {
        const thing = target ? this.find(target, this.thing) : this.thing.assoc.location?._thing;
        if (!thing) {
            this.errorNoThing(target);
            return this.commandDescripton(null, `looks for a ${target} but doesn't see any`, 'look', [], false);
        }
        else if (thing === this.thing) {
            this.output(this.examination(thing));
            return this.commandDescripton(null, `looks at themself`, 'examine', [thing]);
        }
        else if (this.thing.isIn(thing)) {
            this.output(this.examination(thing));
            return this.commandDescripton(null, `looks around`, 'examine', [thing]);
        }
        else {
            this.output(this.description(thing));
            return this.formatDescripton(null, 'looks at $arg', [thing], 'look', [thing]);
        }
    }
    // COMMAND
    examine(cmdInfo, target) {
        if (!target) {
            this.error(`What do you want to examine ? `);
        }
        else {
            const thing = this.find(target, this.thing);
            if (!thing) {
                this.errorNoThing(target);
                return this.commandDescripton(null, `tries to examine a ${target} but doesn't see any`, 'examine', [], false);
            }
            else {
                this.output(this.examination(thing));
                if (thing === this.thing) {
                    return this.commandDescripton(null, `looks at themself`, 'examine', [thing]);
                }
                else if (this.thing.isIn(thing)) {
                    return this.commandDescripton(null, `looks around`, 'examine', [thing]);
                }
                else {
                    return this.formatDescripton(null, 'examines $arg', [thing], 'examine', [thing]);
                }
            }
        }
    }
    // COMMAND
    go(cmdInfo, directionStr) {
        const direction = this.find(directionStr, this.thing);
        const otherLink = direction?.assoc.otherLink;
        const destination = otherLink?.assoc.linkOwner || direction;
        const evt = new MoveDescripton(this.thing, 'go', this.thing, destination, direction, directionStr);
        if (!this.substituting) {
            this.eventCommand('go', null, this.thing, evt);
        }
        this.continueMove(cmdInfo, evt);
        !evt.failed && this.connectionFor(evt.thing).look(cmdInfo);
    }
    // COMMAND
    inventory(cmdInfo) {
        const things = (this.thing.refs.location).map(item => this.formatName(item)).join('\n');
        this.output(`<span class='pre'>You are carrying ${things ? '\n' : 'nothing'}${indent(3, things)}</span>`);
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
    atClock(cmdInfo, rate) {
        if (rate.match(/^[0-9]+$/)) {
            this.world.clockRate = Number(rate);
            this.pending.push(this.world.store());
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
    get(cmdInfo, thingStr, ...args) {
        const location = this.thing.assoc.location;
        let loc = location;
        if (args.length) {
            const [_, name] = findSimpleName(args.join(' '));
            loc = this.find(name, loc);
            if (!loc)
                return this.errorNoThing(name);
        }
        const thing = this.find(thingStr, this.thing);
        if (thing?.isIn(this.thing))
            return this.error(`You are already holding ${this.formatName(thing)}`);
        if (!thing)
            return this.errorNoThing(thingStr);
        if (thing === this.thing)
            return this.error(`You just don't get yourself. Some people are that way...`);
        if (thing === location)
            return this.error(`You just don't get this place. Some places are that way...`);
        const evt = new MoveDescripton(this.thing, 'get', thing, this.thing, null, null);
        evt.exitFormat = "$forothers";
        evt.moveFormat = `You pick up $event.thing`;
        evt.enterFormat = `$event.actor picks up $event.thing`;
        this.eventCommand(evt.event, null, thing, evt);
        this.continueMove(cmdInfo, evt);
    }
    // COMMAND
    drop(cmdInfo, thingStr) {
        const thing = this.find(thingStr, this.thing);
        if (!thing)
            return this.errorNoThing(thingStr);
        if (!thing.isIn(this.thing))
            return this.error(`You aren't holding ${thingStr}`);
        const evt = new MoveDescripton(this.thing, 'get', thing, this.thing.assoc.location, null, null);
        evt.exitFormat = "$forothers";
        evt.moveFormat = `You drop $event.thing`;
        evt.enterFormat = `$event.actor drops $event.thing`;
        this.eventCommand(evt.event, null, thing, evt);
        this.continueMove(cmdInfo, evt);
    }
    // COMMAND
    atSay(cmdInfo, text, ...args) {
        if (text[0] === '"')
            text = text.substring(1, text.length - 1);
        const ctx = formatContexts(text);
        args = this.findAll(args, undefined, 'thing');
        ctx.me && this.output(`You say, "${this.basicFormat(this.thing, ctx.me, args)}"`);
        ctx.others && this.formatDescripton(this.thing, `says, "${ctx.others}"`, args, 'say', [text]);
    }
    // COMMAND
    async say(cmdInfo, ...words) {
        const text = escape(dropArgs(1, cmdInfo));
        this.output(`You say, "${text}"`);
        return this.commandDescripton(this.thing, `$quote says, "${text}"`, 'say', [text]);
    }
    // COMMAND
    async whisper(cmdInfo, thingStr, ...words) {
        const thing = this.find(thingStr);
        const text = escape(dropArgs(2, cmdInfo));
        if (!thing)
            return this.errorNoThing(thingStr);
        this.output(`You whisper, "${text}", to ${this.formatName(thing)}`);
        connectionMap.get(thing)?.output(`$quote ${this.formatName(this.thing)} whispers, "${text}", to you`);
    }
    // COMMAND
    async act(cmdInfo, ...words) {
        const text = escape(dropArgs(1, cmdInfo));
        return this.commandDescripton(this.thing, `<i>$quote ${this.formatName(this.thing)} ${text}</i>`, 'act', [text], true, false, false);
    }
    // COMMAND
    gesture(cmdInfo, thingStr, ...words) {
        const thing = this.find(thingStr);
        const text = escape(dropArgs(2, cmdInfo));
        if (!thing)
            return this.errorNoThing(thingStr);
        this.formatDescripton(this.thing, '$quote <i>$this ${text} at $arg</i>', [thing], 'act', [text, thing], true, false, false);
    }
    // COMMAND
    atContinue(cmdInfo) {
        this.substituting = false;
    }
    // COMMAND
    atCreate(cmdInfo, protoStr, name) {
        const proto = this.find(protoStr, this.world.hallOfPrototypes);
        if (!proto) {
            const hall = this.world.hallOfPrototypes;
            const protos = [];
            for (const aproto of hall.refs.location) {
                protos.push(`%${aproto.id} %proto:${aproto.name}`);
            }
            this.error(`<pre>Could not find prototype ${protoStr}
Prototypes:
${protos.join('\n  ')}`);
        }
        else {
            const fullname = dropArgs(2, cmdInfo);
            const thing = this.world.createThing(fullname);
            thing.setPrototype(proto);
            this.created.push(thing);
            if (this.created.length > 100)
                this.created = this.created.slice(this.created.length - 50);
            if (thing._prototype === this.world.roomProto.id) {
                this.output(`You created a room: ${this.dumpName(thing)}`);
            }
            else if (thing._prototype === this.world.linkProto.id) {
                this.output(`You created a link: ${this.dumpName(thing)}`);
            }
            else {
                thing.assoc.location = this.thing;
                this.output(`You are holding your new creation: ${this.dumpName(thing)}`);
            }
        }
    }
    // COMMAND
    atPatch(cmdInfo, subjectStr, viewerStr, protoStr) {
        const subject = this.find(subjectStr, null, 'subject');
        const viewer = this.find(viewerStr, null, 'viewer');
        const proto = this.find(protoStr);
        const patch = this.world.createThing(subject.fullName);
        if (proto) {
            patch.__proto__ = proto;
            patch._prototype = proto.id;
        }
        patch.assoc.patch = subject.id;
        patch.assoc.patchFor = viewer.id;
        this.created.push(patch);
        this.world.stamp(patch);
        this.output(`Patched ${this.formatName(subject)} for ${this.formatName(viewer)} with ${this.formatName(patch)}`);
    }
    // COMMAND
    getPrototype(name) {
        return this.find(name, this.world.hallOfPrototypes, `${name} prototype`);
    }
    // COMMAND
    atLink(cmdInfo, loc1Str, exit1Str, exit2Str, loc2Str) {
        checkArgs(cmdInfo, arguments);
        const loc1 = this.find(loc1Str, this.thing, 'location1');
        const loc2 = this.find(loc2Str, this.thing, 'location2');
        const linkProto = this.getPrototype('link');
        const exit1 = this.world.createThing(exit1Str);
        const exit2 = this.world.createThing(exit2Str);
        exit1.name = exit1Str;
        exit1.setPrototype(linkProto);
        exit1.assoc.linkOwner = loc1;
        exit1.assoc.otherLink = exit2;
        exit2.name = exit2Str;
        exit2.setPrototype(linkProto);
        exit2.assoc.linkOwner = loc2;
        exit2.assoc.otherLink = exit1;
        this.output(`Linked ${this.dumpName(loc1)}->${this.dumpName(exit1)}--${this.dumpName(exit2)}<-${this.dumpName(loc2)}`);
    }
    // COMMAND
    atJs(cmdInfo) {
        const line = dropArgs(1, cmdInfo);
        //const [, varSection, codeSection] = line.match(/^((?:(?:[\s,]*[a-zA-Z]+\s*=\s*)?[^\s]+)+[\s,]*;)?\s*(.*)\s*$/)
        const [, varSection, codeSection] = line.match(/^((?:[\s,]*[a-zA-Z_][a-zA-Z_0-9]*\s*=\s*(?:%-[0-9]|[a-zA-z0-9%][a-zA-Z0-9:_]*)(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)+[\s,]*;)?(.*)$/);
        const vars = [];
        const values = [];
        let code = codeSection;
        let argN = 1;
        if (varSection) {
            for (const [, varname, path] of varSection.matchAll(/[,\s]*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([a-zA-Z%_]-?[a-zA-Z_0-9:]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*)/g)) {
                const components = path.split(/\s*\.\s*/);
                let value = this.find(components[0], undefined, 'thing');
                vars.push(varname || `___arg${argN++}`);
                for (const component of components.slice(1)) {
                    value = value[component];
                }
                values.push(value);
            }
        }
        else {
            code = line;
            const semis = code.match(/\s*;*/);
            if (semis)
                code = code.substring(semis[0].length);
        }
        // tslint:disable-next-line:only-arrow-functions, no-eval
        const result = this.thing.thingEval('(' + vars.join(', ') + ')', code).apply(this, values.map(t => t?._thing ? t?._thing.specProxy : t));
        if (result instanceof CommandContext) {
            return result.run();
        }
        else {
            this.output(this.formatValue(result));
        }
    }
    // COMMAND
    atMethod(cmdInfo, thingStr, prop) {
        const thing = this.find(thingStr, undefined, 'receiver');
        const code = dropArgs(3, cmdInfo);
        const realProp = '!' + prop;
        if (!code) {
            if (typeof thing[realProp] === 'function') {
                delete thing[realProp];
                this.output(`Deleted function ${thingStr}.${prop}`);
            }
            else {
                this.error(`No function ${thingStr}.${prop}`);
            }
        }
        else {
            const match = code.match(/^\s*(\([^()]*\))((?:.|\s)*)$/);
            if (!match) {
                this.error(`Bad syntax, expected @method thing property (args) body`);
            }
            else {
                const [, args, body] = [...match];
                thing.setMethod(realProp, args, body);
                this.output(`Defined function ${thingStr}.${prop}`);
            }
        }
    }
    // COMMAND
    atCall(cmdInfo, thingStr, prop, ...args) {
        const thing = this.find(thingStr, undefined, 'receiver');
        const method = thing['!' + prop];
        const things = (this.findAll(args, undefined, 'thing')).map(t => t?.specProxy);
        if (typeof method !== 'function') {
            this.error(`No function ${thingStr}.${prop}`);
        }
        else {
            const result = method.apply(this.connectionFor(thing), things);
            if (result instanceof CommandContext) {
                return result.run();
            }
            else {
                this.output(result + '');
            }
        }
    }
    // COMMAND
    atCommands(cmdInfo, thingStr) {
        checkArgs(cmdInfo, arguments);
        const things = cmdWords(cmdInfo).slice(1).map(t => this.find(t, undefined, 'thing'));
        const idNames = new Map();
        const assocs = new Map();
        let result = '@script ';
        let i = 0;
        function addLine(line) {
            result += `\n${indent(3, line).trim()}`;
        }
        console.log('COMMANDS FOR ', ...things);
        things.sort((a, b) => a.id - b.id); // ensure backreferences to created things are OK
        this.stdIds().forEach(id => idNames.set(id, this.adminName(id)));
        for (i = 0; i < things.length; i++) {
            const thing = things[i];
            const pindex = things.findIndex(t => t.id === thing._prototype);
            const protoName = pindex !== -1 ? `%${pindex - i}` : this.adminName(thing._prototype);
            result += `\n@create ${protoName} ${(thing._article + ' ' + thing._fullName).trim()}`;
            idNames.set(thing.id, `%${i - things.length}`);
        }
        for (const thing of things) {
            const spec = thing.spec();
            const ref = idNames.get(thing.id);
            const name = spec.name;
            assocs.set(thing, spec.associations);
            delete spec.prototype;
            delete spec.id;
            delete spec.name;
            delete spec.associations;
            delete spec.associationThings;
            for (const prop of Object.keys(spec)) {
                const val = spec[prop];
                if (val instanceof BigInt) {
                    addLine(`@setbigint ${ref} ${prop} ${val}`);
                }
                else if (typeof val === 'number') {
                    addLine(`@setnum ${ref} ${prop} ${val}`);
                }
                else if (typeof val === 'boolean') {
                    addLine(`@setbool ${ref} ${prop} ${val}`);
                }
                else {
                    addLine(`@set ${ref} ${prop} ${val}`);
                }
            }
            addLine(`@set ${ref} name ${name}`);
        }
        for (const thing of things) {
            const ref = idNames.get(thing.id);
            const seen = new Set();
            for (const [nm, val] of assocs.get(thing)) {
                const vthing = idNames.get(val);
                const pfx = vthing ? '' : '!;;//ASSOCIATION WITH NONSTANDARD OBJECT: ';
                result += `\n${pfx}@${seen.has(nm) ? 'assocMany' : 'assoc'} ${ref} ${nm} ${vthing || '%' + val}`;
                seen.add(nm);
            }
        }
        this.output(`<pre><span class='property'><span class='input-text'><span class='select'>${result}</span></span></span></pre>`);
    }
    // COMMAND
    atDump(cmdInfo, thingStr) {
        checkArgs(cmdInfo, arguments);
        const thing = this.find(thingStr);
        if (!thing)
            return this.error('could not find ' + thingStr);
        console.log('DUMPING ', thing);
        const spec = thing.spec();
        const myKeys = new Set(Object.keys(thing).filter(k => !reservedProperties.has(k) && k[0] === '_'));
        const allKeys = [];
        const fp = (prop, noParens = false) => this.formatDumpProperty(thing, prop, noParens);
        const fm = (prop, noParens = false) => this.formatDumpMethod(thing, prop, noParens);
        let result = `<span class='code'>${this.dumpName(thing)}
${fp('prototype', true)}: ${thing._prototype ? this.dumpName(thing.world.getThing(thing._prototype)) : 'none'}
${fp('location', true)}--> ${this.dumpName(thing.assocId.location)}
${fp('linkOwner', true)}--> ${this.dumpName(thing.assoc.linkOwner)}
${fp('otherLink', true)}--> ${this.dumpName(thing.assoc.otherLink)}
<--(location)--${this.dumpThingNames(thing.refs.location)}
<--(linkOwner)--${this.dumpThingNames(thing.refs.linkOwner)}`;
        for (const prop in thing) {
            if (prop === '_associations' || prop === '_associationThings')
                continue;
            if (prop[0] === '_' && !reservedProperties.has(prop)) {
                allKeys.push(prop);
            }
            else if (prop[0] === '!') {
                allKeys.push(prop);
            }
        }
        allKeys.sort();
        for (const prop of allKeys) {
            const propName = prop.substring(1);
            if (prop[0] === '_') {
                result += `\n   ${fp(propName)}: ${escape(JSON.stringify(thing[prop]))} `;
            }
            else if (prop[0] === '!') {
                const [args, body] = JSON.parse(thing[prop]._code);
                result += `\n   ${fm(propName)}: ${escape(args)} ${escape(body)} `;
            }
        }
        const associationMap = new Map();
        for (const [k, v] of thing._associations) {
            if (k === 'location' || k === 'linkOwner' || k === 'otherLink')
                continue;
            if (!associationMap.has(k))
                associationMap.set(k, new Set());
            associationMap.get(k).add(this.world.getThing(v));
        }
        const associations = Array.from(associationMap.keys());
        associations.sort();
        for (const key of associations) {
            result += `\n   ${fp(key)} --> ${Array.from(associationMap.get(key)).map(t => this.formatName(t)).join(' ')} `;
        }
        const backlinks = new Map();
        for (const associate of thing.assoc.refs()) {
            for (const [k, v] of associate._associations) {
                if (k === 'location' || k === 'linkOwner' || k === 'otherLink' || v !== thing.id)
                    continue;
                if (!backlinks.has(k))
                    backlinks.set(k, []);
                backlinks.get(k).push(associate);
            }
        }
        for (const link of backlinks.keys()) {
            result += `\n < --(${link})--${this.dumpThingNames(backlinks.get(link))} `;
        }
        result += '</span>';
        this.output(result);
    }
    // COMMAND
    atFail(cmdInfo /*, actor, text, arg..., @event, actor, event, arg...*/) {
        if (!this.event)
            return this.error(`Error in @fail, there is no current event`);
        const words = splitQuotedWords(dropArgs(1, cmdInfo));
        // tslint:disable-next-line:prefer-const
        let [contextStr, text, ...args] = words;
        if (text[0] === '"')
            text = JSON.parse(text);
        const context = this.find(contextStr, undefined, 'context');
        const evtIndex = words.findIndex(w => w.toLowerCase() === '@emit');
        const emitter = (evtIndex !== -1 && this.find(words[evtIndex + 1], context, 'emitter')) || this.thing.assoc.location;
        this.event.emitFail(emitter, text, args.map(t => this.find(t, context, 'arg')), false, emitter);
    }
    // COMMAND
    atOutput(cmdInfo /*, actor, text, arg..., @event, actor, event, arg...*/) {
        const words = splitQuotedWords(dropArgs(1, cmdInfo));
        // tslint:disable-next-line:prefer-const
        let [contextStr, text] = words;
        if (text[0] === '"')
            text = JSON.parse(text);
        const ctx = formatContexts(text);
        const context = this.find(contextStr, undefined, 'context');
        const evtIndex = words.findIndex(w => w.toLowerCase() === '@event');
        if (evtIndex === -1 || words.length - evtIndex < 3) {
            throw new Error('@output needs @event actor eventType');
        }
        // tslint:disable-next-line:prefer-const
        let [actorStr, ...eventArgs] = words.slice(evtIndex + 1);
        const actor = this.find(actorStr, undefined, 'actor');
        const formatWords = words.slice(2, evtIndex);
        const formatArgs = formatWords.length ? this.findAll(formatWords) : [];
        let output = false;
        if (ctx.me) {
            if (connection.thing === actor) {
                const forMe = connection.formatMe(context, text, ...formatArgs);
                connection.output(forMe);
                output = true;
            }
            else {
                for (const [thing, con] of connectionMap) {
                    if (thing === actor) {
                        const forMe = connection.formatMe(actor, text, ...formatArgs);
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
                    : (this.find(word)) || word;
            }
            return this.formatDescripton(context, ctx.others, formatArgs, event, eventArgs, succeeded, false, output, null, actor);
        }
    }
    // COMMAND
    atMove(cmdInfo, thingStr, locStr) {
        const thing = this.find(thingStr);
        const loc = this.find(locStr);
        if (!thing)
            return this.error(`Could not find ${thingStr} `);
        if (!loc)
            return this.error(`Could not find ${locStr} `);
        thing.assoc.location = loc;
        this.output(`You moved ${thingStr} to ${locStr} `);
    }
    // COMMAND
    atAs(cmdInfo, thingStr) {
        const thing = this.find(thingStr, this.thing, 'actor');
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
        const oldSubst = con.substituting;
        try {
            con.substituting = false;
            return con.command(cmd, false, true);
        }
        finally {
            con.substituting = oldSubst;
        }
    }
    // COMMAND
    atAdmin(cmdInfo, thingStr, toggle) {
        checkArgs(cmdInfo, arguments);
        const thing = this.find(thingStr);
        if (!thing)
            return this.error(`Could not find ${thingStr} `);
        const con = connectionMap.get(thing);
        const boolVal = toggle.toLowerCase() in { t: true, true: true };
        const user = this.world.getUserForThing(thing);
        if (user.admin !== boolVal) {
            user.admin = boolVal;
            this.pending.push(this.world.putUser(user));
            if (con)
                con.admin = boolVal;
            if (boolVal)
                con.output(`${this.formatName(this.thing)} just upgraded you`);
        }
        this.output(`You just ${toggle ? 'upgraded' : 'downgraded'} ${thingStr} `);
        con.verboseNames = boolVal;
    }
    // COMMAND
    atAdd(cmdInfo, thingStr, property, thing2Str) {
        checkArgs(cmdInfo, arguments);
        const thing = this.find(thingStr, this.thing, 'thing');
        const thing2 = this.find(thing2Str, this.thing, 'thing2');
        const prop = '_' + property.toLowerCase();
        if (!Array.isArray(thing[prop]) && !addableProperties.has(prop)) {
            return this.error(`${property} is not a list`);
        }
        if (!thing[prop]) {
            thing[prop] = [thing2.id];
        }
        else if (thing[prop].indexOf(thing2.id) === -1) {
            if (!thing.hasOwnProperty(prop))
                thing[prop] = thing[prop].slice();
            thing[prop].push(thing2.id);
            this.output(`Added ${thing2Str} to ${property} `);
        }
        else {
            this.error(`${thing2Str} is already in ${property} `);
        }
    }
    // COMMAND
    atRemove(cmdInfo, thingStr, property, thing2Str) {
        checkArgs(cmdInfo, arguments);
        const thing = this.find(thingStr, this.thing, 'thing');
        const thing2 = this.find(thing2Str, this.thing, 'thing2');
        const prop = '_' + property.toLowerCase();
        if (!Array.isArray(thing[prop]) && !addableProperties.has(prop)) {
            this.error(`${property} is not a list`);
        }
        const index = thing[prop].indexOf(thing2.id);
        if (index !== -1) {
            thing[prop].splice(index, 1);
            this.output(`Removed ${thing2Str} from ${property} `);
        }
        else {
            this.error(`${thing2Str} is not in ${property} `);
        }
    }
    // COMMAND
    atReproto(cmdInfo, thingStr, protoStr) {
        checkArgs(cmdInfo, arguments);
        const thing = this.find(thingStr, this.thing, 'thing');
        const proto = this.find(protoStr, this.world.hallOfPrototypes, 'prototype');
        thing.__proto__ = proto;
        thing._prototype = proto.id;
        this.output(`You changed the prototype of ${this.formatName(thing)} to ${this.formatName(proto)} `);
    }
    // COMMAND
    atInstances(cmdInfo, protoStr) {
        const proto = this.find(protoStr, this.thing, 'prototype');
        let result = `<pre> Instances of ${this.formatName(proto)}: `;
        for (const inst of this.world.getInstances(proto)) {
            result += `\n   ${this.formatName(inst)} `;
        }
        this.output(result + '</pre>');
    }
    // COMMAND
    atsetbigint(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments);
        return this.atSet(cmdInfo, thingStr, property, BigInt(value));
    }
    // COMMAND
    atsetbool(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments);
        return this.atSet(cmdInfo, thingStr, property, Boolean(value));
    }
    // COMMAND
    atsetnum(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments);
        return this.atSet(cmdInfo, thingStr, property, Number(value));
    }
    // COMMAND
    atSet(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments);
        const [thing, lowerProp, realProp, val] = this.thingProps(thingStr, property, value, cmdInfo);
        const cmd = cmdInfo.line.match(/^[^\s]*/)[0].toLowerCase();
        value = cmd === '@setbool' ? Boolean(val)
            : cmd === '@setbigint' ? BigInt(val)
                : cmd === '@setnum' ? Number(val)
                    : val;
        if (!thing)
            return;
        if (addableProperties.has(realProp))
            return this.error(`Cannot set ${property} `);
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
                const location = this.find(value);
                if (!location) {
                    this.error('Could not find location ' + value);
                    return;
                }
                thing.assoc.location = location;
                break;
            }
            case 'linkowner':
                const owner = this.find(value);
                if (!owner) {
                    this.error('Could not find link owner ' + value);
                    return;
                }
                thing.assoc.linkOwner = owner;
                break;
            case 'otherlink':
                const other = this.find(value);
                if (!other) {
                    this.error('Could not find other link ' + value);
                    return;
                }
                thing.assoc.otherLink = other;
                break;
            case 'prototype':
                const proto = this.find(value, this.world.hallOfPrototypes);
                if (!proto) {
                    this.error('Could not find prototype ' + value);
                    return;
                }
                thing.setPrototype(proto);
                break;
            default:
                if (value instanceof Thing)
                    value = value.id;
                thing[realProp] = value;
                break;
        }
        this.output(`set ${thingStr} ${property} to ${value} `);
    }
    atScript(cmdInfo) {
        const lines = dropArgs(1, cmdInfo).split(/\n(?=[^\s])/);
        this.runCommands(lines);
    }
    atAssoc(cmdInfo, thingStr, prop, otherStr) {
        checkArgs(cmdInfo, arguments);
        const thing = this.find(thingStr, this.thing, 'thing');
        const otherThing = this.find(otherStr, this.thing, 'other thing');
        thing.assoc[prop] = otherThing;
    }
    atAssocmany(cmdInfo, thingStr, prop, otherStr) {
        checkArgs(cmdInfo, arguments);
        const thing = this.find(thingStr, this.thing, 'thing');
        const otherThing = this.find(otherStr, this.thing, 'other thing');
        thing.assocMany[prop] = otherThing;
    }
    atDelassoc(cmdInfo, thingStr, prop, otherStr) {
        checkArgs(cmdInfo, arguments);
        const thing = this.find(thingStr, this.thing, 'thing');
        const otherThing = this.find(otherStr, this.thing, 'other thing');
        if (otherStr) {
            thing.assoc.dissociate(prop, otherThing);
        }
        else {
            thing.assoc.dissociateNamed(prop);
        }
    }
    atCopy(cmdInfo, thingStr, force) {
        checkArgs(cmdInfo, arguments);
        const connected = new Set();
        const thing = this.find(thingStr, this.thing, 'thing');
        thing.findConnected(connected);
        this.checkConnected(thingStr, connected, force && force.toLowerCase() === 'force');
        const newThing = thing.copy(connected);
        this.created.push(newThing);
        newThing.assoc.location = this.thing;
        this.output(`You copied ${this.formatName(thing)} to your inventory`);
    }
    checkConnected(thingStr, connected, force) {
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
    }
    atToast(cmdInfo, thingStr) {
        checkArgs(cmdInfo, arguments);
        const things = this.findAll([...arguments].slice(1), this.thing, 'thing');
        let out = '';
        const all = new Set();
        for (const thing of things) {
            const connected = new Set();
            thing.findConnected(connected);
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
                all.add(item);
            }
            out += `<div> You toasted ${this.formatName(thing)} `;
            if (connected.size > 1) {
                const num = connected.size - 1;
                out += ` and everything it was connected to(${num} other object${num === 1 ? '' : 's'})`;
            }
            out += '<\div>';
        }
        this.pending.push(this.world.toast(all));
        this.output(out);
    }
    // COMMAND
    atDelay(cmdInfo) {
        if (this.world.transactionPromise) {
            // tslint:disable-next-line:no-floating-promises
            this.world.transactionPromise
                .then(() => setTimeout(async () => this.command(dropArgs(1, cmdInfo)), 1));
        }
        else {
            setTimeout(async () => this.command(dropArgs(1, cmdInfo)), 1);
        }
    }
    // COMMAND
    atBluepill(cmdInfo) {
        const thingStr = dropArgs(1, cmdInfo);
        const thing = thingStr ? this.find(thingStr, this.thing) : this.thing;
        const con = thing && connectionMap.get(thing);
        if (con) {
            con.verboseNames = false;
            this.output(`You take the blue pill.You feel normal`);
        }
        else {
            this.error(`Could not find ${thingStr} `);
        }
    }
    // COMMAND
    atRedpill(cmdInfo) {
        const thingStr = dropArgs(1, cmdInfo);
        const thing = thingStr ? this.find(thingStr, this.thing) : this.thing;
        const con = thing && connectionMap.get(thing);
        if (con) {
            con.verboseNames = true;
            this.output(`You take the red pill.You feel abnormal.Don't you wish you had taken the blue pill?`);
        }
        else {
            this.error(`Could not find ${thingStr}`);
        }
    }
    // COMMAND
    atDel(cmdInfo, thingStr, property) {
        checkArgs(cmdInfo, arguments);
        const [thing, lowerProp, realProp, value, propMap] = this.thingProps(thingStr, property, undefined, cmdInfo);
        if (!thing)
            return;
        if (!propMap.has(lowerProp)) {
            return this.error('Bad property: ' + property);
        }
        if (reservedProperties.has(realProp) || addableProperties.has(realProp)) {
            return this.error('Reserved property: ' + property);
        }
        delete thing[realProp];
        this.checkTicker(thing);
        this.output(`deleted ${property} from ${thing.name}`);
    }
    // COMMAND
    atFind(cmdInfo, target, startStr) {
        checkArgs(cmdInfo, arguments);
        const start = startStr ? this.find(startStr, this.thing, 'location') : this.thing;
        const thing = this.find(target, start, 'target');
        this.output(this.dumpName(thing));
    }
    // COMMAND
    async atInfo() {
        const hall = this.world.hallOfPrototypes;
        const protos = [];
        for (const proto of hall.refs.location) {
            protos.push(`<span class='thing'>%${proto.id}</span> <span class='thing'>%proto:${proto.name}</span>`);
        }
        this.output(`<pre>Name: ${this.world.name}
Your user name: ${this.user}${this.admin ? ' (admin)' : ''}
You: ${this.dumpName(this.thing)}
lobby: ${this.dumpName(this.world.lobby)}
limbo: ${this.dumpName(this.world.limbo)}
hall of prototypes: ${this.dumpName(this.world.hallOfPrototypes)}
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
        this.output(`Prototypes:<br><br>${(hall.refs.location).map(t => this.dumpName(t)).join('<br>')}`);
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
                return this.output(`<pre>${this.helpText(argLen, command)}</pre>`);
            }
        }
        cmds.sort();
        for (const name of cmds) {
            const command = this.commands.get(name);
            if (command.alt)
                continue;
            if (result)
                result += '\n';
            result += this.helpText(argLen, command);
        }
        this.output('<pre>' + result + `

You can use <b>me</b> for yourself, <b>here</b> for your location, and <b>out</b> for your location's location (if you're in a container)${this.admin ? adminHelp : ''}</pre>`);
    }
    helpText(argLen, command) {
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
                result += indent(argLen - args.length, '') + '  --  ' + this.basicFormat(this.thing, command.help[i + 1], []);
            }
        }
        return result;
    }
}
MudConnection.prototype.commands = initCommands(commands);
function splitQuotedWords(line) {
    return line.split(wordAndQuotePat).filter(x => x); // discard empty strings
}
function indent(spaceCount, str) {
    let spaces = '';
    for (let i = 0; i < spaceCount; i++) {
        spaces += ' ';
    }
    return str.replace(/(^|\n)/g, '$1' + spaces);
}
function dropArgs(count, cmdInfo) {
    return cmdInfo.line.split(/(\s+)/).slice(count * 2).join('');
}
function cmdWords(cmdInfo) {
    return cmdInfo.line.split(/ +/).filter(x => x.trim());
}
export function capitalize(str, templateWord = 'A') {
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
    const contexts = format.split(/(\s*\$forme\b\s*|\s*\$forothers\b\s*)/i);
    const tmp = {};
    if (contexts.length > 1) {
        for (let i = 1; i < contexts.length; i += 2) {
            tmp[contexts[i].trim().substring(1).toLowerCase()] = contexts[i + 1];
        }
        if (tmp.forme && !tmp.forothers)
            tmp.forothers = contexts[0];
        if (!tmp.forme && tmp.forothers)
            tmp.forme = contexts[0];
        return {
            me: tmp.forme,
            others: tmp.forothers,
        };
    }
    return { others: contexts[0], me: contexts[0] };
}
function thingPxy(item) {
    return !(item instanceof Thing) ? item : item._thing.specProxy;
}
function pxyThing(item) {
    return !(item instanceof Thing) ? item : item._thing || item;
}
function pxyThings(items) {
    return items.map(item => !(item instanceof Thing) ? item : item._thing || item);
}
function checkThing(thing) {
    if (thing && !(thing instanceof Thing))
        throw new Error();
}
function synchronousError() {
    return new Error('There are no promises because the world is synchronous');
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
        await connection.toplevelCommand(text, true);
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
        const thing = connection.world.getThing(user.thing);
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