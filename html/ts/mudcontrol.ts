import {
    MudState, RoleState, PeerState,
    mudTracker, roleTracker, peerTracker,
} from './base'
import {
    World,
    Thing,
    thingId,
    findSimpleName,
    escape,
    idFor,
} from './model'
import {current as peer} from './peer'

export const currentVersion = 2
export let connection: MudConnection
const connectionMap = new Map<Thing, MudConnection>()
export let activeWorld: World
const wordAndQuotePat = /("(?:[^"\\]|\\.)*")|\s+/
const wordAndQuotePatWS = /("(?:[^"\\]|\\.)*"|\s+)/
const opPat = /^[-+*/%^|&<>=]|==|!=|<=|>=|not$/
const reservedProperties = new Set([
    '_id',
    '_prototype',
    '_contents',
    '__proto__',
])

const stdAssocsOrder = [
    'location',
    'linkOwner',
    'otherLink',
    'destination',
    'key',
    'visibleTo',
    'hides',
    'patch',
    'patchFor',
]
const stdAssocs = new Set(stdAssocsOrder)

function stdAssoc(name: string) {
    name = name.toLowerCase()
    return [...stdAssocs].find(a => a.toLowerCase() === name)
}

const addableProperties = new Set([
    '_aliases',
])

const setHelp = ['thing property value', `Set a property on a thing:
  location    -- move the thing to another location
  linkowner   -- set the thing's linkOwner
  otherlink   -- set the thing's otherLink
  description -- the thing's description, you can use format words in a description (see FORMAT WORDS).
                 If you capitalize a format word, the substitution will be capitalized.

  STANDARD PROPERTIES:
    name                   -- simple one-word name for this object, for commands to find it
    fullName               -- the full name, this also sets article and name
    article                -- precedes the formatted name when this is displayed
    description            -- format string for look/examine commands (see FORMAT WORDS)
    closed                 -- whether this object propagates descriptons to its location
    globalCommand          -- whether this object can contribute commands to others in its location
    hidden                 -- whether this object is invisible
    -- FORMATS --
    examineFormat          -- format contents and links (see FORMAT WORDS)
    contentsFormat         -- format an item in contents (see FORMAT WORDS)
    enterFormat            -- format when someone enters a container
    enterFailFormat        -- format when someone tries to enter a closed thing (see FORMAT WORDS)
    exitFormat             -- format when someone leaves a container
    exitFailFormat         -- format when someone tries to exit a closed thing (see FORMAT WORDS)
    linkFormat             -- format how this item links to its other link (see FORMAT WORDS)
    linkMoveFormat         -- format when someone moves through a link (see FORMAT WORDS)
    linkEnterFormat        -- format when someone enters through the link (see FORMAT WORDS)
    linkExitFormat         -- format when someone leaves through the link (see FORMAT WORDS)
    linkFailFormat         -- format when someone without a key tries to use a locked link (see FORMAT WORDS)
    -- COMMAND PROPERTIES --
    cmd                    -- command template for when the object's name is used as a command
    cmd_WORD               -- command template for when the WORD is used as a command
    go_WORD                -- event template when someone does 'go WORD' and WORD doesn't exist (virtual directions)
    -- EVENT INTERCEPTS --    These are templates that can interfere with event propagation
    event_go               -- event template for going that involves the object (called at each stage)
    event_go_thing         -- event template for going somewhere
    event_go_direction     -- event template for going through the object
    event_go_origin        -- event template for going to the object
    event_go_destination   -- event template for going from the object
    event_get              -- event template for getting that involves the object (called at each stage)
    event_get_thing        -- event template for getting the object
    event_get_origin       -- event template for getting things from the object
    event_get_destination  -- event template for when the object gets things
    event_drop             -- event template for dropping that involves the object (called at each stage)
    event_drop_thing       -- event template for dropping the object
    event_drop_origin      -- event template for when the object drops things
    event_drop_destination -- event template for dropping things into the object
    -- EVENT REACTIONS --     for objects that react to events
    react_EVENT            -- template that reacts to an event (or descripton), see EVENTS

  EVENT PROPERTIES
    The standard event properties, beginning with "event_" (event_go_thing, etc.) can be either
    command templates or methods. If one exists, it is invoked. If both exist, the method is
    invoked in preference to the template.

  RESERVED PROPERTIES YOU CANNOT SET
    id                     -- objects can't change their ID
`
]

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

On any thing, you can traverse a path with dot-notation, like %proto:thing.name or me.assoc.location

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
`

export class Command {
    help: string[]
    admin: boolean
    alt: string
    alts: Command[]
    minArgs: number
    name: string
    method: string

    constructor({ help, admin, alt }: any) {
        this.help = help
        this.admin = admin
        this.alt = alt
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
        help: ['thing', `grab a thing`,
            'thing from location', `grab a thing from a location`]
    })],
    ['drop', new Command({ help: ['thing', `drop something you are carrying`] })],
    ['@call', new Command({ help: ['thing.property arg...', `Call a method on a thing`] })],
    ['@run', new Command({ help: ['thing property arg...', `Call a command macro on a thing`] })],
    ['@if', new Command({
        help: ['thing property @then commands...', '',
            'thing property not @then commands...', ``,
            'thing property op value @then commands...', ``,
            'thing property op thing property @then commands...', `Run commands if expression is true
  op can be >, >=, <, <=, =, ==, or !=
  properties can be paths, thing.prop.prop`]
    })],
    ['@change', new Command({
        help: ['thing property not', '',
            'thing property op amount', '',
            'thing property op thing2 property2', `change a value by amount
  op can be +, -, *, /, %, ^, &, or |
  properties can be paths, thing.prop.prop`]
    })],
    ['@dup', new Command({
        help: ['thing prop prop2', '',
            'thing prop thing2 prop2', `transfer prop2's value into prop
  properties can be paths, thing.prop.prop`]
    })],
    ['@exit', new Command({ help: ['', `cut out of command list`] })],
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
    ['@dumpinh', new Command({
        help: ['thing', `See properties of a thing plus its inherited properties
   You can use %% as a synonym for @dumping if they're the first characters of a command
`]
    })],
    ['@commands', new Command({ help: ['thing', `Print commands to recreate a thing`] })],
    ['@move', new Command({ help: ['thing location', 'Move a thing'] })],
    ['@fail', new Command({
        help: ['format', '',
            'format [@context context arg...]', '',
            'format [@event actor type]', '',
            'format [@context ...] [@event ...]', `Fail the current event and emit a format string

   context and args are for the format string (see FORMAT STRINGS)
   If it has $forme, it will output to the user, if it has $forothers, that will output to others`]
    })],
    ['@echo', new Command({
        help: ['formatWords...', `Print a format string with this.thing as context
  If $forothers is present, emit an 'echo' descripton`]
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
    ['@patch', new Command({
        help: ['subject viewer', '',
            'subject viewer prototype', 'Patch subject for a viewer']
    })],
    ['@toast', new Command({ help: ['thing...', 'Toast things and everything they\'re connected to'] })],
    ['@copy', new Command({
        help: ['thing', '',
            'thing force', `Copy a thing to your inventory (force allows copying the entire world -- can be dangerous)`]
    })],
    ['@edit', new Command({
        help: ['things', '',
            'thing force', `Print a script that edits one or more things`]
    })],
    ['@recreate', new Command({
        help: ['things', '',
            'thing force', `Print a script that creates one or more things and moves them to your inventory`]
    })],
    ['@editcopy', new Command({
        help: ['things', `Print a script that produces a copy of one or more things and moves them to your inventory`]
    })],
    ['@find', new Command({
        help: ['thing', 'Find a thing from your current location',
            'thing @from start', `Find a thing starting at a particular thing
  you can use the special word all for things to find all things from a particular thing`,]
    })],
    ['@link', new Command({
        help: ['link loc', '',
            'link1 loc1 link2', '',
            'link1 loc1 link2 loc2', `create links between two things, loc2 defaults to here`]
    })],
    ['@info', new Command({ help: ['', 'List important information'] })],
    ['@as', new Command({ help: ['thing command...', 'Make a thing execute a command'] })],
    ['@add', new Command({
        help: ['thing property thing2', `Add thing2 to the list or set in property
  thing2 is optional, if it is not present, create an empty set

  LIST PROPERTIES
  aliases   -- alternate names
`], admin: true
    })],
    ['@remove', new Command({ help: ['thing property thing2', `Remove thing2 from the list in property`], admin: true })],
    ['@stop', new Command({ help: ['', `Stop the clock`], admin: true })],
    ['@start', new Command({ help: ['', `Start the clock`], admin: true })],
    ['@clock', new Command({ help: ['seconds', `Change the clock rate`], admin: true })],
    ['@setnum', new Command({ help: ['thing property number'], admin: true, alt: '@set' })],
    ['@setbigint', new Command({ help: ['thing property bigint'], admin: true, alt: '@set' })],
    ['@setbool', new Command({ help: ['thing property boolean'], admin: true, alt: '@set' })],
    ['@set', new Command({ help: setHelp })],
    ['@del', new Command({ help: ['thing property', `Delete a properties from a thing so it will inherit from its prototype`] })],
    ['@continue', new Command({ help: ['', 'Continue substitution'] })],
    ['@use', new Command({
        help: ['things', `pushes things on created array so you can use them as %-1 through %-N
  %1 refers to the last thing given`]
    })],
    ['@script', new Command({
        help: ['commands', `Commands is a set of optionally indented lines.
  Indentation indicates that a line belongs to the unindented command above it`]
    })],
    ['@assoc', new Command({
        help: ['thing property thing...', `Set association between a thing and other things

  STANDARD ASSOCIATIONS
    location        -- if this thing has a location, it is in its location's contents (see FORMAT WORDS)
    linkOwner       -- the owner of this link (if this is a link)
    otherLink       -- the other link (if this is a link)
    destination     -- where this link leads to (can be used instead of otherLink)
    key             -- locks that this thing can open
    visibleTo       -- this item is only visible to these viewers
    hides           -- this item hides these things from viewers it is visible to
    patch           -- override properties on the associated thing(s) for one of more viewers
    patchFor        -- viewers who percieve the patch's properties
`]
    })],
    ['@addassoc', new Command({
        help: ['thing property thing...', `Add associations between a thing and other things`]
    })],
    ['@delassoc', new Command({
        help: ['thing property', '',
            'thing property thing...', `Dissociate a thing from some things or from all things`]
    })],
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
])

export function init() { }

export function initCommands(cmds: Map<string, Command>) {
    cmds.forEach(initCommand)
    return cmds
}

export function initCommand(command: Command, cmdName: string, cmds: Map<string, Command>) {
    command.name = cmdName
    if (command.minArgs === undefined) {
        command.minArgs = 1000
    }
    command.name = cmdName
    if (command.alt) {
        const alt = cmds.get(command.alt)

        if (!alt.alts) alt.alts = []
        cmds.get(command.alt).alts.push(command)
    }
    if (cmdName[0] === '@') {
        command.admin = true
        command.method = 'at' + capitalize(cmdName.substring(1))
    } else {
        command.method = command.name
    }
    for (let i = 0; i < command.help.length; i += 2) {
        command.minArgs = Math.min(command.minArgs, command.help[i].split(/ +/).length)
    }
}

export class Descripton {
    connection: MudConnection
    source: Thing
    tick: number
    event: string
    args: any
    failed: boolean
    ignoreClosed: boolean
    done: boolean
    succeedHooks: (() => void)[] = []
    failHooks: (() => void)[] = []
    failureFormat: string

    constructor(source: Thing, event: string, args: any[], failed: boolean) {
        this.connection = connectionMap.get(source) || connection
        this.tick = connection.tickCount
        this.source = source
        this.event = event
        this.failed = failed
        this.args = args
        for (let i = 0; i < args.length; i++) {
            this[i] = args[i]
        }
    }
    toString() {
        return `{${this.constructor.name}}`
    }
    copy(): this {
        return { __proto__: this } as any
    }
    get actor() { return this.source }
    emit(thing: Thing, visitFunc: (thing: Thing) => void, excludes?: any[], visitLinks = false) {
        excludes = excludes ? pxyThings(excludes) : [thing._thing, thing._thing.world.limbo]
        this.propagate(thing._thing, new Set(excludes), visitFunc, visitLinks)
    }
    props(thing: Thing) {
        return this.connection.props(thing)
    }
    /**
     * Propagate to a thing and its contents
     * If the thing is open, also propagate to its location
     * If this.visitLinks is true, also propagate through links
     */
    propagate(thing: Thing, visited: Set<Thing>, visitFunc: (thing: Thing, descripton?: Descripton) => void, visitLinks: boolean) {
        if (this.done || !thing || visited.has(thing)) return
        visited.add(thing)
        visitFunc(thing, this)
        for (const item of thing.refs.location) {
            this.propagate(item, visited, visitFunc, visitLinks)
        }
        for (const item of thing.assocMany.linkOwner) {
            this.propagate(item, visited, visitFunc, visitLinks)
        }
        if (visitLinks) {
            for (const item of thing.refs.linkOwner) {
                const otherLink = thing.assoc.otherLink
                const dest = thing.assoc.destination

                otherLink && this.propagate(otherLink, visited, visitFunc, visitLinks)
                dest && this.propagate(dest, visited, visitFunc, visitLinks)
            }
        }
        if (!this.props(thing)._closed || this.ignoreClosed) return this.propagate(thing.assoc.location, visited, visitFunc, visitLinks)
    }
    wrapThings() {
        this.source = this.source?.specProxy
    }
    unwrapThings() {
        this.source = this.source?._thing
    }
    sendOutput(start: Thing, formatString: string, args: Thing[], prefix: boolean, context = start) {
        const prefixStr = prefix ? capitalize(this.connection.formatName(this.actor._thing)) + ' ' : ''

        this.emit(start, t => {
            const con = connectionMap.get(t)

            if (con) {
                con.withResults(connection, () => {
                    // run format in each connection so it can deal with admin, names, etc.
                    con.output(prefixStr + con.basicFormat(context, formatString, args))
                })
            } else {
                // process reactions in the main MudConnection
                connection.react(t, this)
            }
        }, [this.actor._thing])
    }
    emitFail(start: Thing, failFormat: string, args: Thing[] = [], prefix?: boolean, context = start) {
        const prefixStr = prefix ? capitalize(this.connection.formatName(this.actor._thing)) + ' ' : ''
        const contexts = formatContexts(failFormat)
        let con = this.connection
        const msg = contexts.me && con.basicFormat(context, contexts.me, args)

        this.fail()
        if (contexts.others) {
            this.emit(start._thing, t => {
                con = connectionMap.get(t)
                if (con) {
                    con.withResults(connection, () => {
                        // run format in each connection so it can deal with admin, names, etc.
                        con.output(prefixStr + con.basicFormat(context, contexts.others, args))
                    })
                } else {
                    // process reactions in the main MudConnection
                    connection.react(t, this)
                }
            }, [this.actor._thing])
        }
        throw new Error(msg)
    }
    fail() {
        if (!this.failed) {
            this.failed = true
            for (const code of this.failHooks) {
                code()
            }
        }
    }
}

class MoveDescripton extends Descripton {
    thing: Thing
    origin: Thing
    destination: Thing
    direction: Thing
    directionString: string
    enterFormat: string
    moveFormat: string
    exitFormat: string

    constructor(actor: Thing, evt: string, thing: Thing, dest: Thing, dir: Thing, dirStr: string) {
        super(actor, evt, [], false)
        this.thing = thing?._thing
        this.origin = thing.assoc.location?._thing
        this.destination = dest?._thing
        this.direction = dir?._thing
        this.directionString = dirStr
        this.wrapThings()
    }
    wrapThings() {
        super.wrapThings()
        this.thing = this.thing?.specProxy
        this.origin = this.origin?.specProxy
        this.destination = this.destination?.specProxy
        this.direction = this.direction?.specProxy
    }
    unwrapThings() {
        super.unwrapThings()
        this.thing = this.thing?._thing
        this.origin = this.origin?._thing
        this.destination = this.destination?._thing
        this.direction = this.direction?._thing
    }
    sendOutputs() {
        this.unwrapThings()
        const copy = this.copy()
        const args = [this.thing, this.origin, this.destination]
        const con = this.connection
        const link = this.props(this.direction?.assoc.otherLink?._thing)
        const outOf = this.origin.assoc.location._thing === this.destination
        const into = this.destination.assoc.location._thing === this.origin

        copy.wrapThings()
        if (!this.moveFormat) {
            if (this.direction && this.direction !== this.destination) {
                this.moveFormat = this.props(this.direction)._linkMoveFormat
            } else if (outOf) {
                this.moveFormat = `You get out of $arg2 into $arg3`
            } else if (into) {
                this.moveFormat = `You get into $arg3 from $arg2`
            } else {
                this.moveFormat = `You go from $arg2 to $arg3`
            }
        }
        if (!this.exitFormat) {
            this.exitFormat = this.props(this.direction)?._linkExitFormat
                || this.origin._exitFormat
                || (outOf && `$event.thing gets out of $arg2 into $arg3`)
                || (into && `$event.thing gets into $arg3 from $arg2`)
                || `$event.thing goes from $arg2 to $arg3`
        }
        if (!this.enterFormat) {
            this.enterFormat = link?._linkEnterFormat
                || this.props(this.destination)._enterFormat
                || (outOf && `$event.thing gets out of $arg2 into $arg3`)
                || (into && `$event.thing gets into $arg3 from $arg2`)
                || `$event.thing goes from $arg2 to $arg3`
        }
        this.moveFormat = formatContexts(this.moveFormat).me
        this.exitFormat = formatContexts(this.exitFormat).others
        this.enterFormat = formatContexts(this.enterFormat).others
        this.moveFormat && con?.output(con.basicFormat(this.direction || this.origin, this.moveFormat, args))
        this.exitFormat && copy.sendOutput(this.origin, this.exitFormat, args, false, this.origin)
        this.enterFormat && copy.sendOutput(this.destination, this.enterFormat, args, false, this.destination)
    }
}

class CommandContext {
    connection: MudConnection
    commands: string[]
    executed = false

    constructor(con: MudConnection) {
        this.connection = con
        this.commands = []
    }
    cmd(...stringsAndThings: any[]) {
        let command = ''

        for (const item of stringsAndThings) {
            if (item instanceof Thing) {
                command += ' %' + item.id
            } else {
                command += item
            }
        }
        this.commands.push(command)
        return this
    }
    cmdf(str: string, ...args: any[]) {
        const chunks = str.split(/(\\\$|\$[0-9]+(?:\.[a-zA-Z0-9_]+)?)/)
        const things = args.map(item => this.findThing(item))
        let command = ''

        for (const chunk of chunks) {
            if (chunk[0] === '$') {
                const [, num, prop] = chunk.match(/^\$([0-9]+)(?:\.([a-zA-Z0-9_]+))?$/)
                let value = things[num]

                if (prop) {
                    value = value[prop]
                }
                if (value instanceof Thing) {
                    command += ` %${value.id} `
                } else {
                    command += value
                }
            } else {
                command += chunk
            }
        }
        this.commands.push(command)
        return this
    }
    run() {
        if (!this.executed) {
            this.executed = true
            return this.connection.runCommands(this.commands)
        }
    }
    findThing(item: any) {
        if (item instanceof Thing) {
            return item
        } else if (typeof item === 'string') {
            return this.connection.find(item)
        } else if (Array.isArray(item)) {
            return this.connection.find(item[0] as string, pxyThing(item[1]), item[2] as string)
        } else {
            throw new Error(`Could not find ${item}`)
        }
    }
}

export class MudConnection {
    world: World
    patchCounts: Map<Thing, number>;
    patches: Map<Thing, Thing>;
    hiddenUpdate = -1
    hiddenThings = new Map<Thing, Set<Thing>>()
    user: string
    admin: boolean
    verboseNames: boolean
    thing: Thing
    outputHandler: (output: string) => void
    created: Thing[]
    failed: boolean
    remote: boolean
    myName: string
    suppressOutput: boolean
    muted = 0
    commands: Map<string, Command>
    conditionResult: any
    event: Descripton
    acted = new Set<Thing>()
    pendingReactions = new Map<Thing, () => void>()
    tickCount = 0
    ticking = false
    stopClock = true
    tickers = new Set<Thing>()
    substituting: boolean
    pending: Promise<any>[]
    quiet: boolean
    exit = false
    hadExit = false

    constructor(thing?: Thing) {
        this.created = []
        this.thing = thing
        this.outputHandler = () => { }
        const con = this
        this.pending = []
        this.patchCounts = new Map()
        this.patches = new Map()
    }
    cmd(...items: any[]) {
        return new CommandContext(this).cmd(...items)
    }
    cmdf(format: string, ...items: any[]) {
        return new CommandContext(this).cmdf(format, ...items)
    }
    init(world, outputHandler, remote = false) {
        this.world = world
        this.outputHandler = outputHandler
        this.remote = remote
    }
    async close() {
        if (this.thing) {
            this.thing.assoc.location = this.thing.world.limbo
        }
        connectionMap.delete(this.thing)
        this.world = null
        this.user = null
        this.admin = false
        this.thing = null
        this.outputHandler = null
        this.created = null
        if (!this.remote) {
            mudTracker.setValue(MudState.NotPlaying)
            roleTracker.setValue(RoleState.None)
        }
    }
    error(text: string) {
        const oldSup = this.suppressOutput
        this.suppressOutput = false
        this.failed = true
        this.output('<div class="error">' + text + '</div>')
        this.suppressOutput = oldSup
    }
    errorNoThing(thing: string) {
        throw new Error(`You don't see any ${removeArticle(thing)} here`)
    }
    output(text: string) {
        if ((!this.suppressOutput && this.muted < 1) || this.failed) {
            this.outputHandler(text.match(/^</) ? text : `<div class='output'>${text}</div>`)
        }
    }
    withResults(otherCon: MudConnection, func: () => void) {
        if (otherCon) {
            const oldEvent = this.event
            const oldCondition = this.conditionResult

            this.event = otherCon.event
            this.conditionResult = otherCon.conditionResult
            try {
                func()
            } finally {
                this.event = oldEvent
                this.conditionResult = oldCondition
            }
        } else {
            func()
        }
    }
    async start(quiet = false) {
        this.quiet = quiet
        if (!this.remote) {
            this.world.watcher = t => this.checkTicker(t)
            for (const thing of this.world.thingCache.values()) {
                this.checkTicker(thing)
            }
        }
        mudTracker.setValue(MudState.Playing)
        if (!quiet) {
            this.outputHandler(`Welcome to ${this.world.name}, use the "login" command to log in.
<p>
<p>
<p>Help lists commands...
<p>
<p>Click on old commands to reuse them`)
        }
        await this.world.start()
    }
    props(thing: Thing) {
        if (!thing) return thing
        if (this.patchCounts.get(thing) === this.world.count) {
            return this.patches.get(thing)
        }
        const patch = this.findPatch(thing)
        this.patchCounts.set(thing, this.world.count)
        this.patches.set(thing, patch)
        return patch
    }
    findPatch(thing: Thing) {
        for (const patch of thing.refs.patch) {
            if (patch.assocId.patchFor === this.thing.id) {
                return this.makePatch(patch, thing)
            }
        }
        return thing
    }
    makePatch(patchProto: any, thing: Thing) {
        const patches = {}
        const choose = (...props: string[]) => {
            let prop

            for (const p of props) {
                if (patches.hasOwnProperty(p)) return patches[p]
                if (patchProto.hasOwnProperty(p)) prop = patchProto[p]
            }
            if (typeof prop !== 'undefined') return prop
            return thing.choose(prop)
        }

        if (this.isStd(thing.id)) patchProto = {}
        return new Proxy(thing, {
            get(obj, prop) {
                const val = patches[prop]

                if (prop === 'choose') return choose
                return typeof val !== 'undefined' ? val
                    : patchProto.hasOwnProperty(prop) ? patchProto[prop]
                        : thing[prop]
            },
            set(obj, prop, value) {
                patches[prop] = value
                return true
            }
        })
    }
    formatMe(tip: thingId | Thing, str: string, ...args: Thing[]) {
        const ctx = formatContexts(str)

        return ctx.me ? this.basicFormat(tip, ctx.me, args) : ''
    }
    // same as formatOthers(...)
    format(tip: thingId | Thing, str: string, ...args: Thing[]) {
        return this.basicFormat(tip, formatContexts(str).others, args)
    }
    formatOthers(tip: thingId | Thing, str: string, ...args: Thing[]) {
        const ctx = formatContexts(str)

        return ctx.others ? this.basicFormat(tip, formatContexts(str).others, args) : ''
    }
    dumpName(tip: thingId | Thing, simpleName?: boolean) {
        const thing = this.world.getThing(tip)

        return thing ? this.formatName(thing, true, true, simpleName) : 'null'
    }
    formatName(thing: any, esc = false, verbose = this.verboseNames, simpleName?: boolean) {
        if (!(thing instanceof Thing)) return thing.toString()
        let output = simpleName ? thing._thing._name : thing._thing.formatName()

        if (esc) output = escape(output)
        if (verbose) {
            output += `<span class='thing'>(%${thing.id})</span>`
        }
        return output
    }
    propCommand(thing: any, prop: string) {
        const val = (thing instanceof Thing ? thing._thing.specProxy : thing)[prop]

        switch (typeof val) {
            case 'boolean':
                return `@setbool %${thing.id} ${prop} `
            case 'number':
                return `@setnum %${thing.id} ${prop} `
            default:
                if (Array.isArray(val)) return `@add %${thing.id} ${prop} `
                if (val instanceof BigInt) return `@setnum %${thing.id} ${prop} `
                return `@set %${thing.id} ${prop} `
        }
    }
    formatDumpProperty(thing: Thing, prop: string, noParens = false) {
        const inherited = !(noParens || thing.hasOwnProperty('_' + prop))
        let val = (thing instanceof Thing ? thing._thing.specProxy : thing)[prop]

        if (Array.isArray(val)) {
            val = val.map(strOrJson).join(' ')
        }
        return `<span class='property${inherited ? ' inherited' : ''}'><span class='hidden input-text'>${this.propCommand(thing, prop)}<span class='select'>${escape(val)}</span></span>${prop}</span>`
    }
    formatAssociation(thing: Thing, assoc: string) {
        const val = thing.assoc.allIdsNamed(assoc)

        if (val.length === 1) {
            return `<span class='property'><span class='hidden input-text'>@assoc %${thing.id} ${assoc} %<span class='select'>${val[0]}</span></span>${assoc}</span>`
        } else {
            let result = '@script'
            let first = true

            for (const a of val) {
                if (first) {
                    result += `\n@assoc `
                    first = false
                } else {
                    result += `\n@assocMany `
                }
                result += `%${thing.id} ${assoc} %${a}`
            }
            return `<span class='property'><span class='hidden input-text'>${result}<span class='select'></span></span>${assoc}</span>`
        }
    }
    formatDumpMethod(thing: Thing, prop: string, noParens = false) {
        const inherited = !(noParens || thing.hasOwnProperty('!' + prop))
        const [args, body] = JSON.parse(thing['!' + prop]._code)

        return `<span class='method${inherited ? ' inherited' : ''}'><span class='hidden input-text'>@method %${thing.id} ${prop} <span class='select'>${escape(args)} ${escape(body)}</span></span>${prop}</span>`
    }
    basicFormat(tip: thingId | Thing, str: string, args: Thing[]) {
        if (!str) return str
        const thing = tip instanceof Thing ? tip._thing : this.world.getThing(tip)
        const adminParts = str.split(/(\s*\$admin\b\s*)/i)
        str = adminParts.length > 1 ? (this.admin && adminParts[2]) || adminParts[0] : str
        const parts = str.split(/( *\$(?:result|event)(?:\.\w*)?| *\$\w*)/i)
        let result = ''
        let enabled = true

        for (const part of parts) {
            const match = part.match(/^( *)\$(.*)$/)

            if (match && enabled) {
                const [_, space, format] = match
                const argMatch = format.toLowerCase().match(/arg([0-9]*)/)

                if (format === 'quote') {
                    enabled = false
                    continue
                }
                result += space
                if (argMatch) {
                    const arg = args[argMatch[1] ? Number(argMatch[1]) - 1 : 0]

                    result += capitalize(this.formatName(arg), format)
                    continue
                } else if (format.match(/^result(?:\.\w+)?$/i)) {
                    const t = this.getResult(format, this.conditionResult)

                    result += capitalize(t instanceof Thing ? this.formatName(t) : t, format)
                    continue
                } else if (format.match(/^event(?:\.\w+)?$/i)) {
                    const t = this.getResult(format, this.event)

                    result += capitalize(t instanceof Thing ? this.formatName(t) : t, format)
                    continue
                }
                switch (format.toLowerCase()) {
                    case 'prototypes': {
                        const ind = '\n      '

                        result += ind + this.world.hallOfPrototypes.refs.location.map(t => this.dumpName(t, true)).join(ind)
                        continue
                    }
                    case 'this': {
                        let name: string

                        if (thing === this.thing) {
                            name = 'you'
                        } else {
                            name = this.formatName(this.props(thing))
                        }
                        result += capitalize(name, format)
                        continue
                    }
                    case 'name': {
                        result += this.props(thing)._name
                        continue
                    }
                    case 'is': {
                        result += this.isPlural(this.props(thing)) ? 'are' : 'is'
                        continue
                    }
                    case 's': {
                        if (!this.isPlural(this.props(thing))) {
                            result += (result.match(/\sgo$/) ? 'es' : 's')
                        }
                        continue
                    }
                    case 'location': {
                        result += capitalize(this.formatName(this.props(thing.assoc.location?._thing)), format)
                        continue
                    }
                    case 'owner': {
                        result += capitalize(this.formatName(this.props(thing.assoc.linkOwner?._thing)), format)
                        continue
                    }
                    case 'link': {
                        const other = thing.assoc.otherLink?._thing
                        const dest = other?.assoc.linkOwner?._thing || thing.assoc.destination?._thing

                        if (dest) {
                            result += capitalize(this.formatName(this.props(dest)), format)
                        }
                        continue
                    }
                    case 'contents': {
                        const contents = thing.refs.location

                        if (contents.length) {
                            for (const item of contents) {
                                if ((!item.assoc.visibleTo || item.assoc.visibleTo === this.thing)
                                    && !this.isHidden(item)) {
                                    result += `<br>&nbsp;&nbsp;${this.format(item, this.props(thing)._contentsFormat)}`
                                }
                            }
                            result += '<br>'
                        }
                        continue
                    }
                    case 'links': {
                        const links = thing.refs.linkOwner

                        if (links.length) {
                            for (const item of links) {
                                if (!this.isHidden(item)) {
                                    result += `<br>&nbsp;&nbsp;${this.format(item, this.props(item)._linkFormat)}`
                                }
                            }
                            result += '<br>'
                        }
                        continue
                    }
                }
            }
            result += part
        }
        return result
    }
    hiddenFor(thing: Thing) {
        let things: Set<Thing>;

        if (this.hiddenUpdate < this.world.count) {
            this.hiddenThings = new Map()
            this.hiddenUpdate = this.world.count
        }
        things = this.hiddenThings.get(thing)
        if (!things) {
            const items = []

            for (const item of thing.refs.visibleTo) {
                items.push(...item.assocMany.hides)
            }
            things = new Set(items)
            this.hiddenThings.set(thing, things)
        }
        return things
    }
    isHidden(thing: Thing, viewer = this.thing) {
        thing = thing._thing
        return (this.props(thing) as any)._hidden || this.hiddenFor(viewer._thing).has(thing)
    }
    description(thing: Thing) {
        return this.format(thing, this.props(thing)._description)
    }
    examination(thing: Thing) {
        const result = this.description(thing)
        const format = this.props(thing)._examineFormat

        return result + (format ? `<br>${this.format(thing, format)}` : '')
    }
    describe(thing: Thing) {
        this.output(this.description(thing))
    }
    checkCommand(prefix: string, cmd: string, thing: any, checkDefault = thing.hasName(cmd)) {
        return (checkDefault && this.props(thing).choose('_' + prefix, '!' + prefix))
            || (cmd && this.props(thing).choose(`!${prefix}_${cmd}`, `_${prefix}_${cmd}`))
    }
    findCommand(words: string[], prefix = 'cmd') {
        const result = this.findTemplate(words, prefix)

        if (result) {
            const [context, template] = result

            return this.substituteCommand(template, [`%${context.id}`, ...words.slice(1)])
        }
    }
    findTemplate(words: string[], prefix: string) {
        const cmd = words[0].toLowerCase()
        let template: string

        for (const item of (this.thing.refs.location) as any[]) {
            if (!this.isHidden(item)) {
                template = this.checkCommand(prefix, cmd, this.props(item))
                if (template) return [item, template]
            }
        }
        for (const item of (this.thing.refs.linkOwner) as any[]) {
            if (!this.isHidden(item)) {
                template = this.checkCommand(prefix, cmd, this.props(item))
                if (template) return [item, template]
            }
        }
        const loc = this.thing.assoc.location?._thing

        template = this.checkCommand(prefix, cmd, this.props(loc))
        if (template) return [loc, template]
        for (const item of (loc.refs.linkOwner) as any[]) {
            if (!this.isHidden(item)) {
                template = this.checkCommand(prefix, cmd, this.props(item))
                if (template) return [item, template]
            }
        }
        for (const item of this.thing.nearby() as any[]) {
            if (item._globalCommand && !this.isHidden(item)) {
                template = this.checkCommand(prefix, cmd, this.props(item))
                if (template) return [item, template]
            }
        }
    }
    substituteCommand(template: any, args: any[]) {
        if (typeof template === 'string') {
            const lines = []
            const words = args.map(a => a instanceof Thing ? `%${a.id}` : a)

            for (const line of template.split(/\n/)) {
                const parts = line.split(/( *\$(?:[0-9]+|\*))/)
                let newCmd = ''

                for (const part of parts) {
                    const match = part.match(/^( *)\$([0-9]+|\*)$/)

                    if (match) {
                        const [_, space, format] = match

                        newCmd += space
                        if (format === '*') {
                            newCmd += words.slice(1).join(' ')
                        } else {
                            newCmd += words[Number(format)]
                        }
                    } else {
                        newCmd += part
                    }
                }
                lines.push(newCmd.trim())
            }
            return lines.length > 0 ? lines : null
        } else if (template instanceof Function) {
            const things = []

            this.substituting = true
            for (const item of args) {
                if (item instanceof Thing) {
                    things.push(thingPxy(item))
                } else {
                    things.push(thingPxy(this.find(item, undefined, 'thing', true)))
                }
            }
            const result = template.apply(this, things)
            return result instanceof CommandContext ? [result] : []
        }
    }
    runCommands(lines: (string | CommandContext)[] | (() => any), notSubstituting = false) {
        const oldSubstituting = this.substituting

        try {
            this.substituting = !notSubstituting
            this.hadExit = false
            if (Array.isArray(lines)) {
                for (const line of lines) {
                    if (line instanceof CommandContext) {
                        line.run()
                    } else {
                        this.command(line, true)
                    }
                    this.hadExit = this.exit // carry this for the next @if
                    if (this.failed || this.exit) break
                }
                this.exit = false
            } else if (lines instanceof Function) {
                return lines()
            }
        } finally {
            this.substituting = oldSubstituting
        }
    }
    // execute toplevel commands inside transactions so they will automatically store any dirty objects
    async toplevelCommand(line: string, user = false) {
        await this.world.doTransaction(async () => {
            if (this.command(line, false, user)) {
                if (this.pending.length) {
                    const promise = Promise.all(this.pending)
                    this.pending = []
                    await promise
                }
            }
        })
            .catch(err => {
                console.log(err)
                this.error(err.message)
            })
            .finally(() => {
                this.failed = false
                this.substituting = false
            })
        if (this.thing?.name !== this.myName) {
            this.myName = this.thing.name
            peer.userThingChanged(this.thing)
        }
    }
    command(line: string, substituted = false, user = false) {
        const originalLine = line
        if (!line.trim()) return
        if (line[0] === '"' || line[0] === "'") {
            line = `say ${line.substring(1)}`
        } else if (line[0] === ':') {
            line = `act ${line.substring(1)}`
        } else if (this.admin && line.match(/^%%/)) {
            line = `@dumpinh ${line.substring(1)}`
        } else if (this.admin && line[0] === '%') {
            line = `@dump ${line}`
        } else if (line[0] === '!') {
            line = `@js ${line.substring(1)}`
        }
        const words = splitQuotedWords(line)
        let commandName = words[0].toLowerCase()

        if (!substituted) {
            this.output('<div class="input">&gt; <span class="input-text">' + escape(originalLine) + '</span></div>')
            if (!this.commands.has(commandName) && this.thing) {
                const newCommands = this.findCommand(words)

                if (newCommands) return this.runCommands(newCommands)
                const target = this.find(words[0], this.thing.assoc.location)
                if (target) {
                    line = `go ${line}`
                    words.unshift('go')
                    commandName = 'go'
                }
            }
        }
        if (this.thing ? this.commands.has(commandName) : commandName === 'login' || commandName === 'help') {
            let command = this.commands.get(commandName)

            if (command.alt) command = this.commands.get(command.alt)
            if (command?.admin && !this.admin && !substituted) {
                return this.error('Unknown command: ' + words[0])
            }
            const muted = this.muted

            if (!substituted && user) this.muted = 0
            try {
                this.update(() => this[command.method]({ command, line, substituted }, ...words.slice(1)))
                return true
            } finally {
                if (this.muted === 0) this.muted = muted
                if (!substituted) this.suppressOutput = false
                const loc = this.thing.assoc.location
                this.output(`<span class='location'>${loc._article + ' '}${loc.fullName}</span>`)
            }
        } else {
            this.error('Unknown command: ' + words[0])
        }
    }
    update(func: () => void) {
        return this.world.update(func)
    }
    findAll(names: string[], start: Thing = this.thing, errTag: string = ''): Thing[] {
        const result = []

        for (const name of names) {
            result.push(this.find(name, start, errTag))
        }
        return result
    }
    getResult(str: string, value: any) {
        const match = str.match(/^[^.]+(?:\.(\w+))?$/)

        return match[1]?.length ? value[match[1]] : value
    }
    doThings(...items: any[]) {
        const func = items[items.length - 1]
        if (typeof func !== 'function') {
            throw new Error('Expected function for with')
        }
        const things = this.findAll(items.slice(0, items.length - 1), undefined, 'thing')
        return func.apply(this, things)
    }
    findThing(name: string, start: Thing = this.thing, errTag: string = '', subst = false): Thing {
        return this.find(name, start, errTag, subst) as Thing
    }
    findInstance(prototype: Thing, name: string, errTag?: string) {
        name = name.trim().toLowerCase()
        let result = this.world.getInstances(prototype).find(t => t.hasName(name))
        if (!result) result = this.find(name)
        if (!result && errTag) throw new Error(`Could not find ${prototype.name} instance named ${name} (${errTag})`)
        return result
    }
    findSimple(nameStr: string, start = this.thing, errTag: string = '', subst = false) {
        const baseThing = this.find(nameStr, start, undefined, subst)
        if (baseThing) return baseThing
        const [, name] = findSimpleName(nameStr)
        let thing = this.find(name, start, undefined, subst)
        const words = new Set(removeArticle(nameStr).split(/\s+/).map(w => w.toLowerCase()))

        if (!thing) { // try extra hard
            for (const word of words) {
                thing = this.find(word, start, undefined, subst)
                if (thing && this.checkSimple(thing, words)) return thing
            }
        } else if (thing && this.checkSimple(thing, words)) {
            return thing
        }
        if (errTag) {
            throw new Error(`Could not find ${errTag}: ${nameStr}`)
        }
    }
    checkSimple(thing: Thing, words: Set<string>) {
        const thingWords = new Set(thing._fullName.split(/\s+/).map(w => w.toLowerCase()))
        let foundName = false

        for (const word of words) {
            if (thing.hasName(word)) {
                foundName = true
            } else if (!thingWords.has(word) && !thing.hasName(word)) {
                return false
            }
        }
        return foundName
    }
    find(name: string, start = this.thing, errTag: string = '', subst = false) {
        let thing: any
        let hadThing = false

        name = name?.trim()
        if (name && (!name.match(/^%|\./) || this.admin || this.substituting || subst)) {
            const [first, ...path] = name.split(/\s*\.\s*/)
            let match: RegExpMatchArray

            // tslint:disable-next-line:no-conditional-assignment
            if ((match = first.match(/^%proto:(.*)$/)) !== null) {
                thing = this.findThing(match[1], this.world.hallOfPrototypes, 'thing')
                // tslint:disable-next-line:no-conditional-assignment
            } else if ((match = first.match(/^%([0-9]+)$/)) !== null) {
                thing = this.world.getThing(Number(match[1]))
                // tslint:disable-next-line:no-conditional-assignment
            } else if ((match = first.match(/^%-([0-9]+)$/)) !== null) {
                thing = this.created[this.created.length - Number(match[1])]
            } else {
                switch (first) {
                    case '%event':
                        thing = this.event;
                        break
                    case 'me':
                    case '%me':
                        thing = this.thing
                        break
                    case 'out':
                    case '%out':
                        const location = this.thing.assoc.location

                        thing = location && location.assoc.location
                        if (!thing || thing === this.world.limbo) {
                            throw new Error('You are not in a container')
                        }
                        break
                    case 'here':
                    case '%here':
                        thing = this.thing.assoc.location
                        break
                    case '%limbo':
                        thing = this.world.limbo
                        break
                    case '%lobby':
                        thing = this.world.lobby
                        break
                    case '%protos':
                        thing = this.world.hallOfPrototypes
                        break
                    default:
                        thing = this.findThingInWorld(start, first)
                        break
                }
            }
            hadThing = thing
            if (thing) {
                for (const segment of path) {
                    thing = (thing instanceof Thing ? thing._thing.specProxy[segment] : thing[segment])
                }
            }
        }
        if (!hadThing && errTag) { // allow returning undefined for paths
            throw new Error(`Could not find ${errTag}: ${name}`)
        }
        return thing
    }
    findThingInWorld(start: Thing, name: string) {
        if (name[0] === '%') name = name.slice(1)
        name = name.toLowerCase()
        return start.find(thing => !this.isHidden(thing) && thing.hasName(name), this.thing.isIn(this.world.limbo) ? new Set() : new Set([this.world.limbo]))
    }
    dumpThingNames(things: Thing[]) {
        const items: string[] = []

        for (const item of things) {
            items.push(this.dumpName(item))
        }
        return items.length ? items.join(', ') : 'nothing'
    }
    thingProps(thingStr: string, property: string, value: any, cmd: any) {
        const thing = this.find(thingStr)
        const propMap = new Map()
        const lowerProp = property.toLowerCase()
        const words = dropArgs(3, cmd)
        const rest = words[0] === '"' ? JSON.parse(words) : words
        let realProp

        if (!thing) {
            throw new Error(`Could not find thing ${thingStr}`)
        } else if (lowerProp === 'id') {
            throw new Error('Cannot change id!')
        } else if (lowerProp === '_proto__') {
            throw new Error('Cannot change __proto__!')
        }
        for (const key in thing) {
            if (key !== '_id' && key[0] === '_') {
                propMap.set(key.substring(1).toLowerCase(), key)
            }
        }
        if (typeof value !== 'undefined' && propMap.has(lowerProp)) {
            realProp = propMap.get(lowerProp)
            const curVal = thing[realProp]

            switch (typeof curVal) {
                case 'number':
                    if (value.match(/^[0-9]+$/)) value = Number(value)
                    break
                case 'boolean':
                    value = value.toLowerCase() in { t: true, true: true }
                    break
                case 'bigint':
                    if (value.match(/^[0-9]+$/)) value = BigInt(value)
                    break
                default:
                    value = rest
                    break
            }
        } else {
            realProp = '_' + property
            value = rest
            if (rest.match(/^[0-9]+$/)) {
                value = Number(rest)
            } else if (rest.toLowerCase().match(/^\s*(true|false)\s*$/)) {
                value = rest.toLowerCase() === 'true'
            }
        }
        return [thing, lowerProp, realProp, value, propMap]
    }
    async doLogin(user: string, password: string, name: string, noauthentication = false) {
        try {
            await this.world.doTransaction(async () => {
                const oldThing = this.thing
                const [thing, admin] = await this.world.authenticate(user, password, name, noauthentication)

                this.user = user
                this.thing = thing._thing
                this.myName = thing.name
                this.admin = admin
                this.verboseNames = admin
                connectionMap.set(this.thing, this)
                if (oldThing && oldThing !== this.thing) connectionMap.delete(oldThing)
                if (!this.quiet) {
                    this.output(`Connected, you are logged in as ${user}.
<br>You can use the login command to change users...
<br><br>`)
                }
                peer.userThingChanged(this.thing)
                thing.assoc.location = this.world.lobby
                this.commandDescripton(this.thing, 'has arrived', 'go', [this.world.limbo, this.world.lobby])
                if ((this.thing as any)._version !== currentVersion) {
                    this.output(`<b>NOTE: THE PREVIOUS RELEASE HAD A MAJOR BUG, PLEASE GO TO THE STORAGE TAB, CLICK THIS WORLD AND DELETE, THEN RESTART TEXTCRAFT</b><br><br>`)
                }
                this.command('look', false, true)
                if (!this.remote) {
                    this.stopClock = false
                    this.queueTick()
                }
            })
        } catch (err) {
            this.error(err.message)
        }
    }
    commandDescripton(context: Thing, action: string, event: string, args: any[], succeeded = true, prefix = true, excludeActor = true, startAt?: Thing, actor = this.thing) {
        return this.formatDescripton(context, action, [], event, args, succeeded, prefix, excludeActor, startAt, actor)
    }
    formatDescripton(actionContext: Thing, action: string, actionArgs: any[], event: string, args: any[], succeeded = true, prefix = true, excludeActor = true, startAt?: Thing, actor = this.thing) {
        if (!this.suppressOutput) {
            const exclude = []
            const desc = new Descripton(actor, event, args, !succeeded)
            const visitFunc = thing => {
                const con = connectionMap.get(thing)

                if (con) {
                    con.withResults(this, () => {
                        // run format in each connection so it can deal with admin and names
                        const format = con.basicFormat(actionContext, action, actionArgs)
                        const text = prefix ? `${capitalize(con.formatName(this.thing))} ${format}` : format

                        con.output(text)
                    })
                } else {
                    // process reactions in the main MudConnection
                    connection.react(thing, desc)
                }
            }


            if (!startAt) startAt = this.thing.assoc.location?._thing
            if (excludeActor) exclude.push(actor)
            desc.emit(startAt, visitFunc, exclude)
        }
    }
    react(thing: Thing, desc: Descripton) {
        if (this.remote) throw new Error(`Attempt to react in a remote connection`)
        const reactPat = new RegExp(`[_!]react_${desc.event.toLowerCase()}`)
        let reacted = false

        for (const key in thing) {
            if (key.toLowerCase().match(reactPat)) {
                this.doReaction(thing, desc, thing[key])
                reacted = true
                break
            }
        }
        if (!reacted && (thing as any)._react) {
            connection.doReaction(thing, desc, (thing as any)._react)
        }
    }
    doReaction(thing: Thing, desc: Descripton, reaction: string | (() => void)) {
        if (this.remote) throw new Error(`Attempt to react in a remote connection`)
        if (this.acted.has(thing) && !this.pendingReactions.has(thing)) {
            this.pendingReactions.set(thing, () => this.doReaction(thing, desc, reaction))
            this.queueTick()
        } else {
            const con = this.connectionFor(thing)

            con.event = desc
            con.conditionResult = this.conditionResult
            this.acted.add(thing)
            con.pending.push(con.runCommands(con.substituteCommand(reaction, [thing, ...desc.args].map(thingPxy))))
        }
    }
    connectionFor(thing: Thing) {
        let con = connectionMap.get(thing._thing)

        if (!con) {
            con = new MudConnection(thing)
            con.admin = true
            con.world = this.world
            con.remote = true
            con.event = this.event
            con.conditionResult = this.conditionResult
            con.suppressOutput = this.suppressOutput
        }
        return con
    }
    checkTicker(thing: Thing) {
        if (this.remote) throw new Error(`Attempt to tick in a remote connection`)
        if ((thing as any)._react_tick) {
            this.tickers.add(thing)
            this.queueTick()
        } else {
            this.tickers.delete(thing)
        }
    }
    queueTick(delay = this.world.clockRate, force = false) {
        if (this.shouldTick() && (force || !this.ticking)) {
            this.ticking = true
            setTimeout((() => this.tick()), Math.max(100, delay))
        }
    }
    shouldTick() {
        if (this.remote) throw new Error(`Attempt to tick in a remote connection`)
        return !this.stopClock && this.world
    }
    async tick() {
        if (this.shouldTick()) {
            const ticked = this.pendingReactions.size || this.tickers.size
            const targetTime = Date.now() + Math.round(this.world.clockRate * 1000)

            this.ticking = true
            this.tickCount++
            this.acted = new Set()
            if (this.pendingReactions.size) {
                const reactions = this.pendingReactions

                this.pendingReactions = new Map()
                for (const reaction of reactions.values()) {
                    reaction()
                }
            }
            if (this.tickers.size) {
                await this.world.doTransaction(async () => {
                    const tick = new Descripton(null, 'tick', [], false)

                    for (const ticker of this.tickers) {
                        const reaction = (ticker as any)._react_tick

                        if (reaction) {
                            tick.source = ticker
                            this.doReaction(ticker, tick, reaction)
                        }
                    }
                    const promise = Promise.all(this.pending)
                    this.pending = []
                    await promise
                })
            }
            if (ticked) {
                this.queueTick(targetTime - Date.now(), true)
            } else {
                this.ticking = false
            }
        }
    }
    hasKey(lock: Thing, start: Thing) {
        if (start._keys.indexOf(lock.id) !== -1) {
            return true
        }
        for (const item of start.refs.location) {
            if (item._keys.indexOf(lock.id) !== -1) {
                return true
            }
        }
        return false
    }
    anyHas(things: Thing[], prop: string, thing = this.thing) {
        return things.find(t => t.assoc.has(prop, pxyThing(thing)))
    }
    findNearby(thing = this.thing) {
        const things = [pxyThing(thing)]

        things.push(...pxyThing(thing).refs.location)
        return things
    }
    inAny(prop: string, target: Thing, thing = this.thing) {
        return (this.findAny(prop, pxyThing(thing)))?.has(target.id)
    }
    findAny(prop: string, thing = this.thing) {
        const ids = []

        thing.assoc.allIdsNamed(prop, ids)
        for (const item of thing.refs.location) {
            item.assoc.allIdsNamed(prop, ids)
        }
        return new Set(ids)
    }
    formatValue(value: any, visited = new Set()) {
        if (value === null) return 'null'
        if (value === undefined) return 'undefined'
        if (typeof value !== 'object') return JSON.stringify(value)
        if (visited.has(value)) return 'circularity'
        visited.add(value)
        if (value instanceof Thing) return `%${this.formatName(value as Thing)}`
        if (Array.isArray(value)) {
            return `[${(value as any[]).map(t => this.formatValue(t, visited)).join(', ')}]`
        } else if (typeof value === 'object') {
            return `{${Object.keys(value).map(k => k + ': ' + this.formatValue(value[k], visited)).join(', ')}}`
        }
        return JSON.stringify(value) || String(value)
    }
    continueMove(cmdInfo, evt: MoveDescripton) {
        const eventProp = `event_${evt.event}`

        if (evt.failed) return
        if (!this.substituting) {
            this.eventCommand(eventProp, 'origin', evt.origin, evt)
        }
        if (evt.failed) return
        if (evt.directionString && !evt.direction) {
            if (this.substituting) throw evt.emitFail(this.thing, `Where is ${evt.directionString}?`)
            // e.g. check if there's a go_north property in the room
            this.eventCommand(`${evt.event}_${evt.directionString}`, null, evt.source.assoc.location, evt)
        } else if (evt.direction && !this.substituting) {
            this.eventCommand(eventProp, 'direction', evt.direction, evt)
        }
        if (evt.failed) return
        if (!evt.destination) throw evt.emitFail(this.thing, `Go where?`)
        if (!this.substituting) {
            this.eventCommand(eventProp, 'destination', evt.destination, evt)
        }
        if (evt.failed) return
        // nothing prevented it so the thing will actually move now
        this.update(() => evt.thing._thing.assoc.location = evt.destination)
        evt.sendOutputs()
    }
    eventCommand(prefix: string, suffix: string, thing: any, event: Descripton) {
        this.event = event
        const cmd = this.checkCommand(prefix, suffix, thing._thing, true)

        if (cmd) {
            const template = this.substituteCommand(cmd, [`%${thing.id}`, ...event.args])

            this.event = event
            template && this.runCommands(template)
            this.substituting = false
        }
    }
    isPlural(thing: Thing) {
        const t = thing?._thing as any

        return !t || (t._plural || t === this.thing)
    }
    adminName(thing: number | Thing) {
        const w = this.world
        const id = idFor(thing)

        return id === w.limbo.id ? '%limbo'
            : id === w.lobby.id ? '%lobby'
                : id === w.thingProto.id ? '%proto:thing'
                    : id === w.roomProto.id ? '%proto:room'
                        : id === w.linkProto.id ? '%proto:link'
                            : id === w.personProto.id ? '%proto:person'
                                : id === w.generatorProto.id ? '%proto:generator'
                                    : '%' + id
    }
    isStd(id: number) {
        return this.stdIds().indexOf(id) !== -1
    }
    stdIds() {
        const w = this.world

        return [
            w.limbo.id,
            w.lobby.id,
            w.thingProto.id,
            w.roomProto.id,
            w.linkProto.id,
            w.hallOfPrototypes.id,
            w.personProto.id,
            w.generatorProto.id]
    }
    // COMMAND
    login(cmdInfo, user, password) {
        setTimeout(() => this.doLogin(user, password, user), 1)
    }
    // COMMAND
    look(cmdInfo, target?) {
        const thing = target ? this.find(target, this.thing) : this.thing.assoc.location?._thing

        if (!thing) {
            this.errorNoThing(target)
            return this.commandDescripton(null, `looks for a ${target} but doesn't see any`, 'look', [], false)
        } else if (thing === this.thing) {
            this.output(this.examination(thing))
            return this.commandDescripton(null, `looks at themself`, 'examine', [thing])
        } else if (this.thing.isIn(thing)) {
            this.output(this.examination(thing))
            return this.commandDescripton(null, `looks around`, 'examine', [thing])
        } else {
            if (!thing._closed) {
                this.output(this.examination(thing))
            } else {
                this.output(this.description(thing))
            }
            return this.formatDescripton(null, 'looks at $arg', [thing], 'look', [thing])
        }
    }
    // COMMAND
    examine(cmdInfo, target?) {
        if (!target) {
            throw new Error(`What do you want to examine ? `)
        } else {
            const thing = this.find(target, this.thing)

            if (!thing) {
                this.errorNoThing(target)
                return this.commandDescripton(null, `tries to examine a ${target} but doesn't see any`, 'examine', [], false)
            } else {
                this.output(this.examination(thing))
                if (thing === this.thing) {
                    return this.commandDescripton(null, `looks at themself`, 'examine', [thing])
                } else if (this.thing.isIn(thing)) {
                    return this.commandDescripton(null, `looks around`, 'examine', [thing])
                } else {
                    return this.formatDescripton(null, 'examines $arg', [thing], 'examine', [thing])
                }
            }
        }
    }
    // COMMAND
    go(cmdInfo, directionStr) {
        const direction = this.find(directionStr, this.thing)
        const otherLink = direction?.assoc.otherLink
        const destination = otherLink?.assoc.linkOwner
            || direction?.assoc.destination
            || direction
            || (this.admin && this.world.getInstances(this.world.roomProto).find(t => t.hasName(directionStr)))
        const evt = new MoveDescripton(this.thing, 'go', this.thing, destination, direction, directionStr)

        if (!this.substituting) {
            this.eventCommand(`event_go`, 'thing', this.thing, evt)
        }
        this.continueMove(cmdInfo, evt)
        !evt.failed && this.connectionFor(evt.thing).look(cmdInfo)
    }
    // COMMAND
    inventory(cmdInfo) {
        const things = (this.thing.refs.location).map(item => this.formatName(item)).join('\n')

        this.output(`<span class='pre'>You are carrying ${things ? '\n' : 'nothing'}${indent(3, things)}</span>`)
    }
    // COMMAND
    atQuiet() {
        this.suppressOutput = true
    }
    // COMMAND
    atLoud() {
        this.suppressOutput = false
    }
    // COMMAND
    atStart() {
        this.stopClock = false
        this.output('Clock started')
        this.queueTick(undefined, true)
    }
    // COMMAND
    atClock(cmdInfo, rate) {
        if (rate.match(/^[0-9]+$/)) {
            this.world.clockRate = Number(rate)
            this.pending.push(this.world.store())
        }
    }
    // COMMAND
    atStop() {
        this.stopClock = true
        this.output('Clock stopped')
    }
    // COMMAND
    atMute() {
        this.output('Muted')
        this.muted = 1
    }
    // COMMAND
    atUnmute() {
        this.muted = -1
        this.output('Unmuted')
    }
    // COMMAND
    get(cmdInfo) {
        const [thingStr, locStr] = keywords(dropArgs(1, cmdInfo), 'from')
        if (!thingStr || !thingStr.trim()) throw new Error('Get what?')
        let location = locStr ? this.findSimple(locStr, this.thing) : this.thing.assoc.location
        if (locStr && !location) throw new Error(`You don't see any ${removeArticle(locStr)} to get ${thingStr} from`)
        let otherLoc = location !== this.thing.assoc.location
        const thing = (otherLoc && this.findSimple(thingStr, location)) || this.findSimple(thingStr, this.thing)
        if (thing?.isIn(this.thing)) throw new Error(`You are already holding ${this.formatName(thing)}`)
        if (!thing) this.errorNoThing(thingStr)
        if (thing === this.thing) throw new Error(`You just don't get yourself. Some people are that way...`)
        if (thing === location) throw new Error(`You just don't get this place. Some places are that way...`)
        if (otherLoc && location._closed) throw new Error(`You can't get ${this.formatName(thing)} from ${this.formatName(location)}`)
        if (thing.assoc.location !== this.thing.assoc.location && !otherLoc) {
            otherLoc = true
            location = thing.assoc.location
        }
        const evt = new MoveDescripton(this.thing, 'get', thing, this.thing, null, null)
        evt.exitFormat = "$forothers"
        evt.moveFormat = `You ${otherLoc ? 'get' : 'pick up'} $event.thing${otherLoc ? ' from ' + this.formatName(location) : ''}`
        evt.enterFormat = `$event.actor ${otherLoc ? 'gets' : 'picks up'} $event.thing${otherLoc ? ' from ' + this.formatName(location) : ''}`
        this.eventCommand(`event_get`, 'thing', thing, evt)
        this.continueMove(cmdInfo, evt)
    }
    // COMMAND
    drop(cmdInfo) {
        const [thingStr, locStr] = keywords(dropArgs(1, cmdInfo), /^(in|into)$/i)
        const thing = this.findSimple(thingStr, this.thing)
        const dest = locStr ? this.findSimple(locStr, this.thing) : this.thing.assoc.location

        if (!thingStr || !thingStr.trim()) throw new Error('Drop what?')
        if (!thing) this.errorNoThing(thingStr)
        if (!thing.isIn(this.thing)) throw new Error(`You aren't holding ${thingStr}`)
        if (!dest) throw new Error(`You don't see any ${removeArticle(locStr)} you can drop ${thingStr} into`)
        const otherLoc = dest !== this.thing.assoc.location
        if (otherLoc && dest._closed) throw new Error(`You can't drop ${this.formatName(thing)} into ${this.formatName(dest)}`)
        const evt = new MoveDescripton(this.thing, 'drop', thing, dest, null, null)
        evt.exitFormat = "$forothers"
        evt.moveFormat = `You drop $event.thing${otherLoc ? ' into ' + this.formatName(dest) : ''} `
        evt.enterFormat = `$event.actor drops $event.thing${otherLoc ? ' into ' + this.formatName(dest) : ''}`
        this.eventCommand(`event_drop`, 'thing', thing, evt)
        this.continueMove(cmdInfo, evt)
    }
    // COMMAND
    atSay(cmdInfo, text, ...args) {
        if (text[0] === '"') text = text.substring(1, text.length - 1)
        const ctx = formatContexts(text)

        args = this.findAll(args, undefined, 'thing')
        ctx.me && this.output(`You say, "${this.basicFormat(this.thing, ctx.me, args)}"`)
        ctx.others && this.formatDescripton(this.thing, `says, "${ctx.others}"`, args, 'say', [text])
    }
    // COMMAND
    async say(cmdInfo, ...words: string[]) {
        const text = escape(dropArgs(1, cmdInfo))

        this.output(`You say, "${text}"`)
        return this.commandDescripton(this.thing, `$quote says, "${text}"`, 'say', [text])
    }
    // COMMAND
    async whisper(cmdInfo, thingStr: string, ...words: string[]) {
        const thing = this.find(thingStr)
        const text = escape(dropArgs(2, cmdInfo))

        if (!thing) this.errorNoThing(thingStr)
        this.output(`You whisper, "${text}", to ${this.formatName(thing)}`)
        connectionMap.get(thing)?.output(`$quote ${this.formatName(this.thing)} whispers, "${text}", to you`)
    }
    // COMMAND
    async act(cmdInfo, ...words: string[]) {
        const text = escape(dropArgs(1, cmdInfo))

        return this.commandDescripton(this.thing, `<i>$quote ${this.formatName(this.thing)} ${text}</i>`, 'act', [text], true, false, false)
    }
    // COMMAND
    gesture(cmdInfo, thingStr: string, ...words: string[]) {
        const thing = this.find(thingStr)
        const text = escape(dropArgs(2, cmdInfo))

        if (!thing) this.errorNoThing(thingStr)
        this.formatDescripton(this.thing, '$quote <i>$this ${text} at $arg</i>', [thing], 'act', [text, thing], true, false, false)
    }
    // COMMAND
    atContinue(cmdInfo) {
        this.substituting = false
    }
    // COMMAND
    atCreate(cmdInfo, protoStr, name) {
        const proto = this.find(protoStr, this.world.hallOfPrototypes)

        if (!proto) {
            const hall = this.world.hallOfPrototypes
            const protos = []

            for (const aproto of hall.refs.location) {
                protos.push(`%${aproto.id} %proto:${aproto.name}`)
            }
            throw new Error(`<pre>Could not find prototype ${protoStr}
Prototypes:
${protos.join('\n  ')}`)
        } else {
            const [fullname, destStr] = keywords(dropArgs(2, cmdInfo), '@in')
            const thing = this.world.createThing(fullname)
            let dest = destStr ? this.findSimple(destStr, this.thing, 'destination') : this.thing
            let output = dest === this.thing ? 'You are holding '
                : dest && dest.instanceof(this.world.personProto) ? `${this.dumpName(dest)} is holding `
                    : 'You created '

            thing.setPrototype(proto)
            this.pushCreated(thing)
            output += `${this.dumpName(thing)}, a ${(thing as any).__proto__._fullName}`
            if (!(thing.instanceof(this.world.roomProto) || thing.instanceof(this.world.linkProto))) {
                dest = dest || this.thing.assoc.location
            }
            if (dest) thing.assoc.location = dest
            if (dest !== this.thing && !(dest && dest.instanceof(this.world.personProto))) {
                output += `, in ${this.dumpName(thing.assoc.location)}`
            }
            if (dest.instanceof(this.world.personProto)) output += ' you created'
            this.output(output)
        }
    }
    shouldHold(thing: Thing) {
        return !(thing instanceof this.world.roomProto.constructor
            || thing instanceof this.world.linkProto.constructor)
    }
    // COMMAND
    atPatch(cmdInfo: any, subjectStr, viewerStr, protoStr) {
        const subject = this.find(subjectStr, null, 'subject')
        const viewer = this.find(viewerStr, null, 'viewer')
        const proto = this.find(protoStr, this.world.hallOfPrototypes)
        const patch = this.world.createThing(subject.fullName);

        if (proto) {
            (patch as any).__proto__ = proto
            patch._prototype = proto.id
        }
        patch.assoc.patch = subject.id
        patch.assoc.patchFor = viewer.id
        this.pushCreated(patch)
        this.world.stamp(patch)
        this.output(`Patched ${this.formatName(subject)} for ${this.formatName(viewer)} with ${this.formatName(patch)}`)
    }
    // COMMAND
    getPrototype(name: string) {
        return this.find(name, this.world.hallOfPrototypes, `${name} prototype`)
    }
    // COMMAND
    atLink(cmdInfo /*, exit2Str, loc1Str, exit1Str, loc2Str*/) {
        checkArgs(cmdInfo, arguments)
        const words = splitQuotedWords(dropArgs(1, cmdInfo))
        const [exit2Str, loc1Str, exit1Str, loc2Str] = words
        const loc1 = loc1Str && this.findInstance(this.world.roomProto, loc1Str, 'location')
        const loc2 = (loc2Str && this.find(loc2Str, this.world.roomProto, 'location')) || this.thing.assoc.location
        const linkProto = this.getPrototype('link')
        const exit1 = exit1Str && this.world.createThing(exit1Str)
        const exit2 = this.world.createThing(exit2Str)

        this.pushCreated(exit2)
        exit2.setPrototype(linkProto)
        exit2.assoc.linkOwner = loc2
        if (exit1) {
            exit2.assoc.otherLink = exit1
            exit1 && this.pushCreated(exit1)
            exit1.setPrototype(linkProto)
            exit1.assoc.linkOwner = loc1
            exit1.assoc.otherLink = exit2
            this.output(`Linked ${this.dumpName(loc2)}->${this.dumpName(exit2)}--${this.dumpName(exit1)}<-${this.dumpName(loc1)}`)
        } else {
            exit2.assoc.destination = loc1
            this.output(`Linked ${this.dumpName(loc2)}->${this.dumpName(exit2)}->${this.dumpName(loc1)}`)
        }
    }
    // COMMAND
    atJs(cmdInfo) {
        const line = dropArgs(1, cmdInfo)
        //const [, varSection, codeSection] = line.match(/^((?:(?:[\s,]*[a-zA-Z]+\s*=\s*)?[^\s]+)+[\s,]*;)?\s*(.*)\s*$/)
        const [, varSection, codeSection] = line.match(/^((?:[\s,]*[a-zA-Z_][a-zA-Z_0-9]*\s*=\s*(?:%-[0-9]|[a-zA-z0-9%][a-zA-Z0-9:_]*)(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)+[\s,]*;)?(.*)$/)
        const vars = []
        const values = []
        let code = codeSection
        let argN = 1

        if (varSection) {
            for (const [, varname, path] of varSection.matchAll(/[,\s]*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([a-zA-Z%_]-?[a-zA-Z_0-9:]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*)/g)) {
                const components = path.split(/\s*\.\s*/)
                let value = this.find(components[0], undefined, 'thing')

                vars.push(varname || `___arg${argN++}`)
                for (const component of components.slice(1)) {
                    value = value[component]
                }
                values.push(value)
            }
        } else {
            code = line
            const semis = code.match(/\s*;*/)
            if (semis) code = code.substring(semis[0].length)
        }
        // tslint:disable-next-line:only-arrow-functions, no-eval
        const result = (this.thing.thingEval('(' + vars.join(', ') + ')', code) as (...args) => any).apply(this, values.map(t => t?._thing ? t?._thing.specProxy : t))
        if (result instanceof CommandContext) {
            return result.run()
        } else {
            this.output(this.formatValue(result))
        }
    }
    // COMMAND
    atMethod(cmdInfo, thingStr, prop) {
        const thing = this.find(thingStr, undefined, 'receiver')
        const code = dropArgs(3, cmdInfo)
        const realProp = '!' + prop

        if (!code) {
            if (typeof thing[realProp] === 'function') {
                delete thing[realProp]
                this.output(`Deleted function ${thingStr}.${prop}`)
            } else {
                throw new Error(`No function ${thingStr}.${prop}`)
            }
        } else {
            const match = code.match(/^\s*(\([^()]*\))((?:.|\s)*)$/)

            if (!match) {
                throw new Error(`Bad syntax, expected @method thing property (args) body`)
            } else {
                const [, args, body] = [...match]
                thing.setMethod(realProp, args, body)
                this.output(`Defined function ${thingStr}.${prop}`)
            }
        }
    }
    // COMMAND
    atCall(cmdInfo, thingStr: string, prop: string, ...args: any[]) {
        const thing = this.find(thingStr, undefined, 'receiver')
        const method = thing['!' + prop]
        const things = (this.findAll(args, undefined, 'thing')).map(t => t?.specProxy)

        if (typeof method !== 'function') {
            throw new Error(`No function ${thingStr}.${prop}`)
        } else {
            const result = method.apply(this.connectionFor(thing), things)

            if (result instanceof CommandContext) {
                return result.run()
            } else {
                this.output(result + '')
            }
        }
    }
    // COMMAND
    atCommands(cmdInfo, thingStr) {
        checkArgs(cmdInfo, arguments)
        const things = cmdWords(cmdInfo).slice(1).map(t => this.find(t, undefined, 'thing'))
        const idNames = new Map<number, string>()
        const assocs = new Map<Thing, any[]>()
        let result = '@script '
        let i = 0
        function addLine(line) {
            result += `\n${indent(3, line).trim()}`
        }

        console.log('COMMANDS FOR ', ...things)
        things.sort((a, b) => a.id - b.id) // ensure backreferences to created things are OK
        this.stdIds().forEach(id => idNames.set(id, this.adminName(id)))
        for (i = 0; i < things.length; i++) {
            const thing = things[i]
            const pindex = things.findIndex(t => t.id === thing._prototype)
            const protoName = pindex !== -1 ? `%${pindex - i}` : this.adminName(thing._prototype)

            result += `\n@create ${protoName} ${(thing._article + ' ' + thing._fullName).trim()}`
            idNames.set(thing.id, `%${i - things.length}`)
        }
        for (const thing of things) {
            const spec = thing.spec()
            const ref = idNames.get(thing.id)
            const name = spec.name

            assocs.set(thing, spec.associations)
            delete spec.prototype
            delete spec.id
            delete spec.name
            delete spec.associations
            delete spec.associationThings
            for (const prop of Object.keys(spec)) {
                const val = spec[prop]

                if (val instanceof BigInt) {
                    addLine(`@setbigint ${ref} ${prop} ${val}`)
                } else if (typeof val === 'number') {
                    addLine(`@setnum ${ref} ${prop} ${val}`)
                } else if (typeof val === 'boolean') {
                    addLine(`@setbool ${ref} ${prop} ${val}`)
                } else {
                    addLine(`@set ${ref} ${prop} ${val}`)
                }
            }
            addLine(`@set ${ref} name ${name}`)
        }
        for (const thing of things) {
            const ref = idNames.get(thing.id)
            const seen = new Set()

            for (const [nm, val] of assocs.get(thing)) {
                const vthing = idNames.get(val)
                const pfx = vthing ? '' : '!;;//ASSOCIATION WITH NONSTANDARD OBJECT: '

                result += `\n${pfx}@${seen.has(nm) ? 'assocMany' : 'assoc'} ${ref} ${nm} ${vthing || '%' + val}`
                seen.add(nm)
            }
        }
        this.output(`<pre><span class='property'><span class='input-text'><span class='select'>${result}</span></span></span></pre>`)
    }
    // COMMAND
    atDump(cmdInfo, thingStr) {
        return this.subDump(cmdInfo, thingStr)
    }
    // COMMAND
    atDumpinh(cmdInfo, thingStr) {
        return this.subDump(cmdInfo, thingStr, true)
    }
    // COMMAND
    subDump(cmdInfo, thingStr, inherited = false) {
        checkArgs(cmdInfo, arguments)
        const thing = this.find(thingStr)
        if (!thing) throw new Error('could not find ' + thingStr)
        console.log('DUMPING ', thing)
        const spec = thing.spec()
        const myKeys = new Set(Object.keys(thing).filter(k => !reservedProperties.has(k) && k[0] === '_'))
        const allKeys = []
        const fp = (prop, noParens = false) => this.formatDumpProperty(thing, prop, noParens)
        const fm = (prop, noParens = false) => this.formatDumpMethod(thing, prop, noParens)
        const fa = (prop) => this.formatAssociation(thing, prop)
        let result = `<span class='code'>${this.dumpName(thing)} <span class='property'>CLICK TO EDIT ALL<span class='hidden input-text'>${this.scriptFor([spec], '@use %' + spec.id)}<span class='select'></span></span></span>
${fp('prototype', true)}: ${thing._prototype ? this.dumpName(thing.world.getThing(thing._prototype)) : 'none'}`
        const nullAssocs = new Set<string>()

        for (const prop of stdAssocs) {
            if (thing.assoc[prop]) {
                result += `\n${fa(prop)} --> ${this.dumpName(thing.assoc[prop])}`
            } else {
                nullAssocs.add(prop)
            }
        }
        if (nullAssocs.size) {
            result += `\n<i>empty: ${stdAssocsOrder.filter(a => nullAssocs.has(a)).join(' ')}</i>`
        }
        for (const prop of stdAssocs) {
            const things = thing.refs[prop]

            if (things.length) result += `\n<--${prop}: ${this.dumpThingNames(things)}`
        }
        if (inherited) {
            for (const prop in thing) {
                if (prop === '_associations' || prop === '_associationThings') continue
                if (prop[0] === '_' && !reservedProperties.has(prop)) {
                    allKeys.push(prop)
                } else if (prop[0] === '!') {
                    allKeys.push(prop)
                }
            }
        } else {
            for (const prop in spec) {
                if (prop === 'associations' || prop === 'associationThings') continue
                if (prop[0] === '!') {
                    allKeys.push(prop)
                } else if (!reservedProperties.has('_' + prop)) {
                    allKeys.push('_' + prop)
                }
            }
        }
        allKeys.sort()
        for (const prop of allKeys) {
            const propName = prop.substring(1)

            if (prop[0] === '_') {
                result += `\n   ${fp(propName)}: ${escape(JSON.stringify(thing[prop]))} `
            } else if (prop[0] === '!') {
                const [args, body] = JSON.parse(thing[prop]._code)

                result += `\n   ${fm(propName)}: ${escape(args)} ${escape(body)} `
            }
        }
        const associationMap = new Map<string, Set<Thing>>()
        for (const [k, v] of thing._associations) {
            if (stdAssocs.has(k)) continue
            if (!associationMap.has(k)) associationMap.set(k, new Set())
            associationMap.get(k).add(this.world.getThing(v))
        }
        const associations = Array.from(associationMap.keys())
        associations.sort()
        for (const key of associations) {
            result += `\n   ${fa(key)} --> ${Array.from(associationMap.get(key)).map(t => this.formatName(t)).join(' ')} `
        }
        const backlinks = new Map<string, Thing[]>()
        for (const associate of thing.assoc.refs()) {
            for (const [k, v] of associate._associations) {
                if (stdAssocs.has(k)) continue
                if (!backlinks.has(k)) backlinks.set(k, [])
                backlinks.get(k).push(associate)
            }
        }
        for (const link of backlinks.keys()) {
            result += `\n < --(${link})--${this.dumpThingNames(backlinks.get(link))} `
        }
        result += '</span>'
        this.output(result)
    }
    scriptFor(specs: any[], firstCode: string) {
        let result = `@script\n${firstCode}`
        let index = -specs.length
        const ids = specs.map(s => s.id)
        const name = (thing) => {
            const idx = ids.indexOf(typeof thing === 'number' ? thing : thing.id)

            return idx === -1 ? this.adminName(thing) : `%${idx - ids.length}`
        }

        for (const spec of specs) {
            const props = [...Object.keys(spec)].filter(p => p !== 'associations' && p !== 'associationThings').sort();
            const fakeSpec = Object.assign({}, spec, { id: index })

            for (const prop of props) {
                let val = spec[prop]

                if (prop === 'associations' || prop === 'associationThings') continue
                if (prop[0] === '!') {
                    const [args, body] = JSON.parse(val)

                    result += `\n@method %${index} ${args} ${indent(2, escape(body)).trim()}`
                } else if (reservedProperties.has('_' + prop)) {
                    continue
                } else {
                    if (Array.isArray(val)) {
                        result += `\n@del %${index} ${prop}`
                        val = val.map(strOrJson).join(' ')
                    } else {
                        val = typeof val === 'string' ? indent(2, val).trim() : val
                    }
                    result += `\n${this.propCommand(fakeSpec, prop)}${val}`
                }
            }
            const assocs = new Map<string, number[]>()
            for (const [prop, id] of spec.associations) {
                let nums = assocs.get(prop)

                if (!nums) {
                    nums = []
                    assocs.set(prop, nums)
                }
                nums.push(id)
            }
            for (const [a, nums] of assocs.entries()) {
                result += `\n@assoc %${index} ${a} ${nums.map(n => name(n)).join(' ')}`
            }
            index++
        }
        return result
    }
    // COMMAND
    atFail(cmdInfo: any /*, actor, text, arg..., @event, actor, event, arg...*/) {
        const [text, contextChunk, argsStr] = keywords(splitQuotedWords(dropArgs(1, cmdInfo)), '@context', '@event')
        const [contextStr, ...args] = contextChunk ? splitQuotedWords(contextChunk) : []
        const [emitterStr, eventType] = argsStr ? splitQuotedWords(argsStr) : []
        const context = contextStr ? this.find(contextStr, undefined, 'context') : this.thing
        const emitter = emitterStr ? this.find(emitterStr, context, 'emitter') : this.thing
        let event = this.event

        if (!event || eventType) {
            event = new Descripton(this.thing, eventType || 'error', [], false)
        }
        event.emitFail(emitter, text, args.map(t => this.find(t, context, 'arg')), false, context)
    }
    // COMMAND
    atRun(cmdInfo: any) {
        const [ctxStr, cmdStr, ...argStrs] = dropArgs(1, cmdInfo).split(/\s+/)
        const ctx = this.find(ctxStr, undefined, 'context')
        const args = argStrs.map((t: string) => this.find(t, undefined, 'argument'))
        const line = ctx['_' + cmdStr]

        if (!line) throw new Error(`Cannot run code, %${ctx.id} has no ${cmdStr} property`)
        args.unshift(ctx)
        this.runCommands(this.substituteCommand(ctx._thing['_' + cmdStr], args), true)
    }
    // COMMAND
    atIf(cmdInfo: any) {
        const [cond, body] = keywords(splitQuotedWords(dropArgs(1, cmdInfo), true, true), '@then')
        if (!body && !splitQuotedWords(dropArgs(1, cmdInfo).toLowerCase(), true, true).find(w => w === '@then')) throw new Error(`@if requires @then`)
        const [thing, prop, val1, op, val2] = this.opArgs(cond)

        if (logic('@if', val1, op, val2)) {
            this.runCommands(body.split('\n'))
            this.exit = this.hadExit
        }
    }
    // COMMAND
    atChange(cmdInfo: any) {
        const [thing, prop, val1, op, val2] = this.opArgs(dropArgs(1, cmdInfo))
        const realProp = this.propFor(thing, prop)

        thing[realProp] = math('@change', val1, op, val2)
        this.output(`You set ${this.formatName(thing)} ${prop} to ${JSON.stringify(thing[realProp])}`)
    }
    opArgs(words: string) {
        const [thingStr, prop, op, arg1, arg2] = splitQuotedWords(words)
        const thing = this.findSimple(thingStr, undefined, 'thing')
        const thing2 = arg2 && this.findSimple(arg1, undefined, 'thing2')

        return [thing, prop, thing[this.propFor(thing, prop)], op, arg2 ? thing2[this.propFor(thing2, arg2)] : arg1?.indexOf('.') > -1 ? this.propFor(thing, arg1) : arg1]
    }
    // COMMAND
    atDup(cmdInfo: any) {
        const [thingStr, prop, thing2Str, rawProp2] = splitQuotedWords(dropArgs(1, cmdInfo))
        if (reservedProperties.has(prop)) throw new Error(`You can't @dup to reserved property ${prop}`)
        const prop2 = rawProp2 || thing2Str
        if (reservedProperties.has(prop2)) throw new Error(`You can't @dup reserved property ${prop2}`)
        const thing = this.findSimple(thingStr, undefined, 'thing')
        const thing2 = rawProp2 ? this.findSimple(thing2Str, undefined, 'thing2') : thing
        const result = thing[this.propFor(thing, prop)] = thing2[this.propFor(thing2, prop2)]

        this.output(`You set ${this.formatName(thing)} ${prop} to ${typeof result === 'object' ? result : JSON.stringify(result)}`)
    }
    // if prop has a dot in it, it's an indirect property, like %me.name
    propFor(thing: any, prop: string) {
        if (prop.indexOf('.') > -1) {
            prop = this.find(prop, undefined, 'property')
        }
        return thing instanceof Thing ? '_' + prop : prop
    }
    // COMMAND
    atExit(cmdInfo: any) {
        this.exit = true
    }
    // COMMAND
    atEcho(cmdInfo: any) {
        const text = splitQuotedWords(dropArgs(1, cmdInfo), true).join('')
        const ctx = formatContexts(text)

        if (ctx.me) {
            this.output(this.basicFormat(this.thing, ctx.me, []))
        }
        if (ctx.others) {
            this.formatDescripton(this.thing, ctx.others, [], 'echo', [this.thing], true, false)
        }
    }
    // COMMAND
    atOutput(cmdInfo: any /*, actor, text, arg..., @event, actor, event, arg...*/) {
        const words = splitQuotedWords(dropArgs(1, cmdInfo))
        // tslint:disable-next-line:prefer-const
        let [contextStr, text] = words
        const ctx = formatContexts(text)
        const context = this.find(contextStr, undefined, 'context')
        const evtIndex = words.findIndex(w => w.toLowerCase() === '@event')
        const actor = evtIndex === -1 ? this.thing : this.find(words[evtIndex + 1], undefined, 'actor')
        const formatWords = words.slice(2, evtIndex)
        const formatArgs = formatWords.length ? this.findAll(formatWords) : []
        let output = false

        if (ctx.me) {
            if (connection.thing === actor) {
                const forMe = connection.formatMe(context, text, ...formatArgs)
                connection.output(forMe)
                output = true
            } else {
                for (const [thing, con] of connectionMap) {
                    if (thing === actor) {
                        const forMe = connection.formatMe(actor, text, ...formatArgs)
                        con.output(forMe)
                        output = true
                        break
                    }
                }
            }
        }
        if (ctx.others && evtIndex !== -1) {
            let [, ...eventArgs] = words.slice(evtIndex + 1) // actor is already computed
            let succeeded = true

            if (eventArgs[0].toLowerCase() === 'false') {
                eventArgs = eventArgs.slice(1)
                succeeded = false
            }
            const event = eventArgs[0]
            eventArgs = eventArgs.slice(1)
            for (let i = 0; i < eventArgs.length; i++) {
                const word = eventArgs[i]

                eventArgs[i] = word[0] === '"' ? JSON.parse(word[0])
                    : (this.find(word)) || word
            }
            return this.formatDescripton(context, ctx.others, formatArgs, event, eventArgs, succeeded, false, output, null, actor)
        } else if (ctx.others && ctx.count) {
            throw new Error('@output needs @event actor eventType')
        }
    }
    // COMMAND
    atMove(cmdInfo: any, thingStr: string, locStr: string) {
        const thing = this.find(thingStr)
        const loc = this.find(locStr)
            || this.world.getInstances(this.world.roomProto).find(t => t.hasName(locStr))

        if (!thing) throw new Error(`Could not find ${thingStr} `)
        if (!loc) throw new Error(`Could not find ${locStr} `)
        thing.assoc.location = loc
        this.output(`You moved ${thingStr} to ${locStr} `)
    }
    // COMMAND
    atAs(cmdInfo: any, thingStr: string) {
        const thing = this.find(thingStr, this.thing, 'actor')
        let con = connectionMap.get(thing)
        const cmd = dropArgs(2, cmdInfo)

        if (!cmd.trim()) throw new Error(`@as expects a command`)
        if (!con) {
            con = new MudConnection(thing)
            con.admin = true
            con.world = this.world
            con.remote = true
        }
        const oldSubst = con.substituting

        try {
            con.substituting = false
            return con.command(cmd, false, true)
        } finally {
            con.substituting = oldSubst
        }
    }
    // COMMAND
    atAdmin(cmdInfo: any, thingStr: string, toggle: string) {
        checkArgs(cmdInfo, arguments)
        const thing = this.find(thingStr)
        if (!thing) throw new Error(`Could not find ${thingStr} `)
        const con = connectionMap.get(thing)
        const boolVal = toggle.toLowerCase() in { t: true, true: true }
        const user = this.world.getUserForThing(thing)

        if (user.admin !== boolVal) {
            user.admin = boolVal
            this.pending.push(this.world.putUser(user))
            if (con) con.admin = boolVal
            if (boolVal) con.output(`${this.formatName(this.thing)} just upgraded you`)
        }
        this.output(`You just ${toggle ? 'upgraded' : 'downgraded'} ${thingStr} `)
        con.verboseNames = boolVal
    }
    // COMMAND
    atAdd(cmdInfo: any /*, thingStr: string, property: string, words */) {
        checkArgs(cmdInfo, arguments)
        const [thingStr, property, ...words] = splitQuotedWords(dropArgs(1, cmdInfo))
        const thing = this.find(thingStr, this.thing, 'thing')
        const prop = this.propFor(thing, property.toLowerCase())

        if (!thing[prop]) {
            thing[prop] = words
        } else {
            if (!Array.isArray(thing[prop])) throw new Error(`${property} is not a list`)
            if (!thing.hasOwnProperty(prop)) thing[prop] = thing[prop].slice()
            thing[prop].push(...words)
        }
        thing[prop] = [...new Set(thing[prop])]
        this.output(`Added ${words.join(' ')} to ${property}, new value: ${thing[prop].join(' ')}`)
    }
    // COMMAND
    atRemove(cmdInfo: any /*, thingStr: string, property: string, thing2Str: string*/) {
        checkArgs(cmdInfo, arguments)
        const [thingStr, property, ...items] = splitQuotedWords(dropArgs(1, cmdInfo))
        const thing = this.find(thingStr, this.thing, 'thing')
        const prop = this.propFor(thing, property.toLowerCase())

        for (const item of items) {
            if (Array.isArray(thing[prop])) {
                const index = thing[prop].indexOf(item)

                thing[prop].splice(index, 1)
            } else if (thing[prop] instanceof Set) {
                thing[prop].delete(item)
            } else {
                throw new Error(`${property} is not a list`)
            }
            this.output(`Removed ${item} from ${property}, new value: ${[...thing[prop]].join(', ')}`)
        }
    }
    // COMMAND
    atReproto(cmdInfo: any, thingStr: string, protoStr: string) {
        checkArgs(cmdInfo, arguments)
        const thing = this.find(thingStr, this.thing, 'thing')
        const proto = this.find(protoStr, this.world.hallOfPrototypes, 'prototype');
        thing.setPrototype(proto)
        this.output(`You changed the prototype of ${this.formatName(thing)} to ${this.formatName(proto)} `)
    }
    // COMMAND
    atInstances(cmdInfo: any, protoStr: string) {
        const proto = this.find(protoStr, this.world.hallOfPrototypes, 'prototype');
        let result = `<pre> Instances of ${this.formatName(proto)}: `

        for (const inst of this.world.getInstances(proto)) {
            result += `\n   ${this.formatName(inst)} `
        }
        this.output(result + '</pre>')
    }
    // COMMAND
    atSetbigint(cmdInfo: any, thingStr: string, property: string, value: string) {
        checkArgs(cmdInfo, arguments)
        return this.baseSet(cmdInfo, thingStr, property, BigInt(value))
    }
    // COMMAND
    atSetbool(cmdInfo: any, thingStr: string, property: string, value: string) {
        checkArgs(cmdInfo, arguments)
        return this.baseSet(cmdInfo, thingStr, property, Boolean(value))
    }
    // COMMAND
    atSetnum(cmdInfo: any, thingStr: string, property: string, value: string) {
        checkArgs(cmdInfo, arguments)
        return this.baseSet(cmdInfo, thingStr, property, Number(value))
    }
    // COMMAND
    atSet(cmdInfo: any /*, thingStr: string, property: string, value: any */) {
        checkArgs(cmdInfo, arguments)
        return this.baseSet.apply(this, [cmdInfo, ...splitQuotedWords(dropArgs(1, cmdInfo))])
    }
    baseSet(cmdInfo: any, thingStr: string, property: string, value: any) {
        const [thing, lowerProp, rp, val] = this.thingProps(thingStr, property, dropArgs(3, cmdInfo), cmdInfo)
        let realProp = rp
        const cmd = cmdInfo.line.match(/^[^\s]*/)[0].toLowerCase()

        value = cmd === '@setbool' ? Boolean(val)
            : cmd === '@setbigint' ? BigInt(val)
                : cmd === '@setnum' ? Number(val)
                    : val
        if (!thing) return
        if (!(thing instanceof Thing) && realProp[0] === '_') realProp = realProp.substring(1)
        if (addableProperties.has(realProp)) throw new Error(`Cannot set ${property} `)
        switch (lowerProp) {
            case 'react_tick':
                thing._react_tick = String(value)
                this.checkTicker(thing)
                break
            case 'fullname': {
                thing.fullName = value
                break
            }
            case 'prototype':
                const proto = this.find(value, this.world.hallOfPrototypes)

                if (!proto) {
                    throw new Error('Could not find prototype ' + value)
                }
                thing.setPrototype(proto)
                break
            default:
                const assoc = stdAssoc(lowerProp)

                if (assoc) {
                    thing.assoc[assoc] = this.find(value, this.thing, assoc)
                } else {
                    if (value instanceof Thing) value = value.id
                    thing[realProp] = value
                }
                break
        }
        this.output(`set ${thingStr} ${property} to ${value} `)
    }
    // COMMAND
    atUse(cmdInfo: any, ...thingStrs: string[]) {
        checkArgs(cmdInfo, arguments)

        this.pushCreated(...thingStrs.map(str => this.find(str, this.thing, 'thing')))
    }
    pushCreated(...things: Thing[]) {
        this.created.push.apply(this.created, things)
        if (this.created.length > 150) this.created = this.created.slice(this.created.length - 100)
    }
    // COMMAND
    atScript(cmdInfo: any) {
        const lines = dropArgs(1, cmdInfo).split(/\n(?=[^\s]|\n)/).map(trimIndents)

        this.runCommands(lines)
    }
    // COMMAND
    atAssoc(cmdInfo: any, thingStr: string, prop: string, otherStr) {
        checkArgs(cmdInfo, arguments)
        const thing = this.find(thingStr, this.thing, 'thing') as Thing
        const words = dropArgs(3, cmdInfo)
        const things = dropArgs(3, cmdInfo).split(' ').map(str => this.find(str, this.thing, 'other thing'))

        thing.assoc[prop] = things[0]
        for (const t of things.slice(1)) {
            thing.assocMany[prop] = t
        }
    }
    // COMMAND
    atAddassoc(cmdInfo: any, thingStr: string, prop: string, otherStr) {
        checkArgs(cmdInfo, arguments)
        const thing = this.find(thingStr, this.thing, 'thing') as Thing
        const words = dropArgs(3, cmdInfo)
        const things = words ? dropArgs(3, cmdInfo).split(' ').map(str => this.find(str, this.thing, 'other thing')) : []

        for (const t of things) {
            thing.assocMany[prop] = t
        }
    }
    // COMMAND
    atDelassoc(cmdInfo: any, thingStr: string, prop: string, otherStr: string) {
        checkArgs(cmdInfo, arguments)
        const thing = this.find(thingStr, this.thing, 'thing') as Thing
        const words = dropArgs(3, cmdInfo)
        const things = words ? dropArgs(3, cmdInfo).split(' ').map(str => this.find(str, this.thing, 'other thing')) : []

        if (things.length) {
            for (const t of things) {
                thing.assoc.dissociate(prop, t)
            }
        } else {
            thing.assoc.dissociateNamed(prop)
        }
    }
    // COMMAND
    atRecreate(cmdInfo: any, ...thingStrs: string[]) {
        checkArgs(cmdInfo, arguments)
        const things = thingStrs.map(str => this.find(str, this.thing, 'thing'))
        const specs = things.map(t => t.spec())
        function index(aThing: Thing) {
            return things.findIndex(t => t.id === aThing.id) - things.length
        }
        const script = this.scriptFor(specs, things.map(t => `${things.length > 1 ? '!;//%' + index(t) + '\n' : ''}@create ${this.adminName(t._prototype).replace(/^%proto:/, '')} ${t.name}`).join('\n')) + things.filter(t => this.shouldHold(t)).map(t => `\n@move %${index(t)} me`).join('')

        this.output(`<span class='property code'><span class='input-text'>${script}<span class='select'></span></span></span></span>`)
    }
    // COMMAND
    atEdit(cmdInfo: any, ...thingStrs: string[]) {
        checkArgs(cmdInfo, arguments)
        const things = thingStrs.map(str => this.find(str, this.thing, 'thing').spec())
        function index(aThing: Thing) {
            return things.findIndex(t => t.id === aThing.id) - things.length
        }
        const script = this.scriptFor(things, things.map(t => `${things.length > 1 ? '!;//%' + index(t) + '\n' : ''}@use ${this.adminName(t.id)}`).join('\n'))

        this.output(`<span class='property code'><span class='input-text'>${script}<span class='select'></span></span></span></span>`)
    }
    // COMMAND
    atEditcopy(cmdInfo: any, ...thingStrs: string[]) {
        checkArgs(cmdInfo, arguments)
        const connected = new Set<Thing>()
        const initialThings = thingStrs.map(str => this.find(str, this.thing, 'thing') as Thing)

        initialThings.forEach(t => t.findConnected(connected))
        const things = [...connected].map(t => t.spec()).sort((a, b) => a.id - b.id)
        function index(aThing: Thing) {
            return things.findIndex(t => t.id === aThing.id) - things.length
        }
        const script = this.scriptFor(things, things.map(t => `${things.length > 1 ? '!;//%' + index(t) + '\n' : ''}@create ${this.adminName(t.id)} ${t.name}`).join('\n')) + initialThings.map(t => `\n@move %${index(t)} me`).join('\n')
        this.output(`<span class='property code'><span class='input-text'>${script}<span class='select'></span></span></span></span>`)
    }
    // COMMAND
    atCopy(cmdInfo: any, thingStr: string, force: string) {
        checkArgs(cmdInfo, arguments)
        const connected = new Set<Thing>()
        const thing = this.find(thingStr, this.thing, 'thing') as Thing

        thing.findConnected(connected)
        this.checkConnected(thingStr, connected, force && force.toLowerCase() === 'force')
        const newThing = thing.copy(connected) as Thing
        this.pushCreated(newThing)
        newThing.assoc.location = this.thing
        this.output(`You copied ${this.formatName(thing)} to your inventory`)
    }
    checkConnected(thingStr: string, connected: Set<Thing>, force: boolean) {
        if (!force) {
            for (const item of connected) {
                if (item === this.world.limbo) {
                    throw new Error(`${thingStr} is connected to Limbo, use force to copy anyway`)
                } else if (item === this.world.lobby) {
                    throw new Error(`${thingStr} is connected to the Lobby, use force to copy anyway`)
                } else if (item === this.world.hallOfPrototypes) {
                    throw new Error(`${thingStr} is connected to the Hall of Prototypes, use force to copy anyway`)
                } else if (connectionMap.has(item)) {
                    throw new Error(`${this.formatName(item)} has a player, use force to copy anyway`)
                }
            }
        }
    }
    // COMMAND
    atToast(cmdInfo: any, thingStr: string) {
        checkArgs(cmdInfo, arguments)
        const things = []
        let out = ''
        const all = new Set<Thing>()

        for (const thing of this.findAll([...arguments].slice(1), this.thing, 'thing')) {
            if (Array.isArray(thing)) {
                things.push.apply(things, thing)
            } else {
                things.push(thing)
            }
        }
        for (const thing of things) {
            const connected = new Set<Thing>()
            thing.findConnected(connected)
            for (const item of connected) {
                if (item === this.world.limbo) {
                    throw new Error(`${this.formatName(thing)} is connected to Limbo`)
                } else if (item === this.world.lobby) {
                    throw new Error(`${this.formatName(thing)} is connected to the Lobby`)
                } else if (item === this.world.hallOfPrototypes) {
                    throw new Error(`${this.formatName(thing)} is connected to the Hall of Prototypes`)
                } else if (connectionMap.has(item)) {
                    throw new Error(`${this.formatName(item)} has a player`)
                }
                all.add(item)
            }
            out += `<div> You toasted ${this.formatName(thing)} `
            if (connected.size > 1) {
                const num = connected.size - 1

                out += ` and everything it was connected to(${num} other object${num === 1 ? '' : 's'})`
            }
            out += '<\div>'
        }
        this.pending.push(this.world.toast(all))
        this.output(out)
    }
    // COMMAND
    atDelay(cmdInfo) {
        if (this.world.transactionPromise) {
            // tslint:disable-next-line:no-floating-promises
            this.world.transactionPromise
                .then(() => setTimeout(async () => this.command(dropArgs(1, cmdInfo)), 1))
        } else {
            setTimeout(async () => this.command(dropArgs(1, cmdInfo)), 1)
        }
    }
    // COMMAND
    atBluepill(cmdInfo) {
        const thingStr = dropArgs(1, cmdInfo)
        const thing = thingStr ? this.find(thingStr, this.thing) : this.thing
        const con = thing && connectionMap.get(thing)

        if (con) {
            con.verboseNames = false
            this.output(`You take the blue pill.You feel normal`)
        } else {
            throw new Error(`Could not find ${thingStr} `)
        }
    }
    // COMMAND
    atRedpill(cmdInfo) {
        const thingStr = dropArgs(1, cmdInfo)
        const thing = thingStr ? this.find(thingStr, this.thing) : this.thing
        const con = thing && connectionMap.get(thing)

        if (con) {
            con.verboseNames = true
            this.output(`You take the red pill.You feel abnormal.Don't you wish you had taken the blue pill?`)
        } else {
            throw new Error(`Could not find ${thingStr}`)
        }
    }
    // COMMAND
    atDel(cmdInfo, thingStr, property) {
        checkArgs(cmdInfo, arguments)
        const [thing, lowerProp, realProp, value, propMap] = this.thingProps(thingStr, property, undefined, cmdInfo)

        if (!thing) return
        if (!propMap.has(lowerProp)) {
            throw new Error('Property not found: ' + property)
        } else if (reservedProperties.has(realProp)) {
            throw new Error('Reserved property: ' + property)
        }
        delete thing[realProp]
        this.checkTicker(thing)
        this.output(`deleted ${property} from ${thing.name}`)
    }
    // COMMAND
    atFind(cmdInfo) {
        checkArgs(cmdInfo, arguments)
        const rest = dropArgs(1, cmdInfo)
        const words = rest.split(/(\s+)/)
        const from = rest.findIndex(w => w.toLowerCase() === '@from')
        const [, startName] = from !== -1 && findSimpleName(words.slice(from + 1).join(''))
        const start = startName ? this.find(startName, this.thing, 'start') : this.thing
        const [, thingName] = findSimpleName((from !== -1 ? words.slice(0, from) : words).join(''))
        const thing = this.find(thingName, start, 'target')

        this.output(this.dumpName(thing))
    }
    // COMMAND
    async atInfo() {
        const hall = this.world.hallOfPrototypes
        const protos = []

        for (const proto of hall.refs.location) {
            protos.push(`<span class='thing'>%${proto.id}</span> <span class='thing'>%proto:${proto.name}</span>`)
        }
        this.output(
            `<pre>Name: ${this.world.name}
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
</pre>`)
    }
    // COMMAND
    async atPrototypes() {
        const hall = this.world.hallOfPrototypes

        this.output(`Prototypes:<br><br>${(hall.refs.location).map(t => this.dumpName(t)).join('<br>')}`)
    }
    // COMMAND
    help(cmdInfo, cmd) {
        let cmds = [...this.commands.keys()].filter(k => !this.commands.get(k).admin || this.admin)
        let result = ''
        let argLen = 0

        if (!this.thing) {
            cmds = ['help', 'login']
        }
        if (cmd && cmds.indexOf(cmd) === -1) {
            throw new Error(`Command not found: ${cmd}`)
        }
        for (const name of cmds) {
            const help = this.commands.get(name).help

            for (let i = 0; i < help.length; i += 2) {
                argLen = Math.max(argLen, name.length + 1 + help[i].length)
            }
        }
        if (cmd) {
            if (this.commands.has(cmd.toLowerCase())) {
                const command = this.commands.get(cmd.toLowerCase())
                const name = command.name
                const help = command.help

                for (let i = 0; i < help.length; i += 2) {
                    argLen = Math.max(argLen, name.length + 1 + help[i].length)
                }
                return this.output(`<pre>${this.helpText(argLen, command)}</pre>`)
            }
        }
        cmds.sort()
        for (const name of cmds) {
            const command = this.commands.get(name)

            if (command.alt) continue
            if (result) result += '\n'
            result += this.helpText(argLen, command)
        }
        this.output('<pre>' + result + `

You can use <b>me</b> for yourself, <b>here</b> for your location, and <b>out</b> for your location's location (if you're in a container)${this.admin ? adminHelp : ''}</pre>`)
    }
    helpText(argLen: number, command: any) {
        let result = ''

        if (command.alts) {
            for (const alt of command.alts) {
                if (result) result += '\n'
                result += `<b>${alt.name} ${alt.help[0]}</b>`
            }
        }
        for (let i = 0; i < command.help.length; i += 2) {
            const args = command.name + ' ' + command.help[i]

            if (result) result += '\n'
            result += `<b>${args}</b>`
            if (command.help[i + 1]) {
                result += indent(argLen - args.length, '') + '  --  ' + this.basicFormat(this.thing, command.help[i + 1], [])
            }
        }
        return result
    }
}
MudConnection.prototype.commands = initCommands(commands)


function logic(label: string, propVal: any, op: string, value: any) {
    if (!op) { // boolean expr
        return valueLike(label, propVal, true)
    } else if (op.trim().toLowerCase() === 'not') {
        return !valueLike(label, propVal, true)
    } else {
        value = valueLike(label, value, propVal)
        switch (op) {
            case '>': return propVal > value
            case '>=': return propVal >= value
            case '<': return propVal < value
            case '<=': return propVal <= value
            case '=': return propVal === value
            case '==': return propVal === value
            case '!=': return propVal !== value
            default:
                throw new Error(`Unknown conditional operation in ${label}: ${op}`)
        }
    }
}

function math(label: string, val1: any, op: string, value?: string | number) {
    if (op.trim().toLowerCase() === 'not') return !valueLike(label, val1, true)
    val1 = valueLike(label, val1, 0) as number
    value = valueLike(label, value, val1) as number
    switch (op) {
        case '+': return val1 + value
        case '*': return val1 * value
        case '-': return val1 - value
        case '/': return val1 / value
        case '%': return val1 % value
        // tslint:disable-next-line:no-bitwise
        case '^': return val1 ^ value
        // tslint:disable-next-line:no-bitwise
        case '&': return val1 & value
        // tslint:disable-next-line:no-bitwise
        case '|': return val1 | value
        default:
            throw new Error(`Unknown arithmetic operation in ${label}: ${op}`)
    }
}

function valueLike(label: string, orig: any, template) {
    let value = String(orig).trim()

    if (typeof orig === typeof template) return orig
    if (typeof template === 'boolean') {
        return orig && !value.match(/^false$/i)
    } else if (typeof template === 'number') {
        if (value.match(/^([0-9]*\.)?[0-9]+$/)) return JSON.parse(value)
        throw new Error(`Value in ${label} should be a number but it is ${orig}`)
    } else if (typeof template === 'string') {
        return orig
    } else if (template instanceof BigInt) {
        if (value.match(/$[0-9]+n^/)) value = value.substring(0, value.length - 1)
        if (value.match(/$[0-9]+^/)) return BigInt(value)
        throw new Error(`Value in ${label} should be a BigInt but it is ${orig}`)
    }
    throw new Error(`Can't convert property ${orig} in ${label} to ${template}`)
}

function splitQuotedWords(line: string, keepWhitespace = false, keepQuotes = false) {
    // discard empty strings
    let words = line.split(keepWhitespace ? wordAndQuotePatWS : wordAndQuotePat).filter(x => typeof x !== 'undefined')

    if (!keepWhitespace) words = words.filter(x => x)
    return keepQuotes ? words : words.map(w => w[0] === '"' ? JSON.parse(w) : w)
}

function strOrJson(str: string) {
    const json = JSON.stringify(str)

    return json.substring(1, json.length - 1) === str ? str : json
}

export function indent(spaceCount: number, str: string) {
    let spaces = ''

    for (let i = 0; i < spaceCount; i++) {
        spaces += ' '
    }
    return str.replace(/(^|\n)/g, '$1' + spaces)
}

export function trimIndents(str: string) {
    let lines = str.split('\n')
    if (lines.length === 1) return str
    const first = lines[0]
    lines = lines.slice(1)
    const minIndent = Math.min(str.length, ...lines.map(l => l.match(/^\s*/)[0].length))

    lines = lines.map(l => l.substring(minIndent))
    lines.unshift(first)
    return lines.join('\n')
}

function removeArticle(str: string) {
    const [article] = findSimpleName(str)

    return (article ? str.trim().substring(article.length) : str).trim()
}

// extract keywords while preserving whitespace
export function keywords(str: string | string[], ...kws: (string | RegExp)[]) {
    kws = kws.map(kw => typeof kw === 'string' ? kw.toLowerCase() : kw)
    const words = Array.isArray(str) ? str : str.split(/(\s+)/)
    const match = (w, i) => {
        const ind = kws.findIndex(k => k instanceof RegExp ? w.match(k) : w === k)

        return ind !== -1 && [i, ind]
    }
    const positions = words.map(w => w.toLowerCase()).map(match).filter(x => x) as [number, number][]
    const before = (i) => i >= positions.length ? words.length
        : positions[i][0] === 0 ? 0
            : positions[i][0] - 1
    const results = [words.slice(0, before(0)).join('')]
    const kwvalues = new Map<number, string>()

    for (let i = 0; i < positions.length; i++) {
        const [pos, kw] = positions[i]

        kwvalues.set(kw, words.slice(pos + 2, before(i + 1)).join(''))
    }
    results.push(...kws.map((_, i) => kwvalues.get(i)))
    return results
}

function dropArgs(count: number, cmdInfo: any) {
    return cmdInfo.line.split(/(\s+)/).slice(count * 2).join('')
}

function cmdWords(cmdInfo: any) {
    return cmdInfo.line.split(/ +/).filter(x => x.trim())
}

export function capitalize(str: string, templateWord: string = 'A') {
    return !templateWord || templateWord[0].toUpperCase() === templateWord[0]
        ? str[0].toUpperCase() + str.substring(1)
        : str
}

function checkArgs(cmdInfo: any, args: any) {
    check(args.length >= cmdInfo.command.minArgs + 1, 'Not enough arguments to ' + cmdInfo.command.name)
}

function check(test: boolean, msg: string) {
    if (!test) throw new Error(msg)
}

function formatContexts(format: string): any {
    const contexts = format.split(/(\s*\$forme\b\s*|\s*\$forothers\b\s*)/i)

    if (contexts.length > 1) {
        const tmp = {} as any
        let count = 1

        for (let i = 1; i < contexts.length; i += 2) {
            tmp[contexts[i].trim().substring(1).toLowerCase()] = contexts[i + 1]
        }
        if (tmp.forme && !tmp.forothers) {
            tmp.forothers = contexts[0]
        } else if (!tmp.forme && tmp.forothers) {
            tmp.forme = contexts[0]
        } else {
            count = 2
        }
        return { me: tmp.forme, others: tmp.forothers, count }
    }
    return { others: contexts[0], me: contexts[0], count: 0 }
}

function thingPxy(item: any): any {
    return !(item instanceof Thing) ? item : item._thing.specProxy
}

function pxyThing(item: any): any {
    return !(item instanceof Thing) ? item : (item as any)._thing || item
}

function pxyThings(items: any[]): any {
    return items.map(item => !(item instanceof Thing) ? item : (item as any)._thing || item)
}

function checkThing(thing: Thing) {
    if (thing && !(thing instanceof Thing)) throw new Error()
}

function synchronousError() {
    return new Error('There are no promises because the world is synchronous')
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
export async function executeCommand(text: string) {
    if (roleTracker.value === RoleState.Solo || roleTracker.value === RoleState.Host) {
        await connection.toplevelCommand(text, true)
    } else if (peerTracker.value !== PeerState.disconnected && mudTracker.value === MudState.Playing) {
        peer.command(text)
    }
}

export async function runMud(world: World, handleOutput: (str: string) => void, quiet?: boolean) {
    activeWorld = world
    world.mudConnectionConstructor = MudConnection
    connection = createConnection(world, handleOutput)
    console.log(connection)
    await connection.start(quiet)
    if (world.defaultUser) {
        const user = world.defaultUser

        if (user) {
            await connection.doLogin(user, null, user, true)
        }
    }
}

export function quit() {
    // tslint:disable-next-line:no-floating-promises
    connection?.close()
    connection = null
}

export function removeRemotes() {
    for (const [thing, con] of connectionMap) {
        if (con.remote) {
            connectionMap.delete(thing)
        }
    }
}

export function myThing() {
    return connection?.thing
}

export async function updateUser(user) {
    if (user.thing && connection) {
        const thing = connection.world.getThing(user.thing)
        const con = connectionMap.get(thing)

        if (con) con.admin = user.admin
    }
}

export type Constructor<T> = (new () => T)

export function spliceConnection<T extends MudConnection>(mudconnectionConstructor: Constructor<T>) {
    const proto = activeWorld.mudConnectionConstructor.prototype;
    mudconnectionConstructor.prototype.__proto__ = proto
    if (mudconnectionConstructor.prototype.hasOwnProperty('commands')) {
        const cmds = mudconnectionConstructor.prototype.commands

        for (const [name, cmd] of activeWorld.mudConnectionConstructor.prototype.commands) {
            cmds.set(name, cmd)
        }
    }
    activeWorld.mudConnectionConstructor = mudconnectionConstructor;
    (connection as any).__proto__ = mudconnectionConstructor.prototype
}

export function createConnection(world: World, outputHandler: (str: string) => void, remote = false) {
    const con = new activeWorld.mudConnectionConstructor()

    con.init(world, outputHandler, remote)
    return con
}
