import {
    MudState, RoleState, PeerState,
    mudTracker, roleTracker, peerTracker,
} from './base.js'
import {
    World,
    Thing,
    thingId,
    findSimpleName,
    escape,
} from './model.js'
import * as mudproto from './mudproto.js'

export let connection: MudConnection
const connectionMap = new Map<Thing, MudConnection>()
export let activeWorld: World
const wordAndQuotePat = /("(?:[^"\\]|\\.)*")|\s+/
const reservedProperties = new Set([
    '_id',
    '_prototype',
    '_contents',
    '__proto__',
])

const addableProperties = new Set([
    '_keys',
])

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
Templates can contain $0..$N to refer to the command arguments. $0 refers to the thing itself.


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
    ['@move', new Command({ help: ['thing location', 'Move a thing'] })],
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
    source: Thing
    tick: number
    event: string
    args: any
    failed: boolean
    visitFunc: (thing: Thing, ton: Descripton) => void
    visitLinks: boolean
    ignoreClosed: boolean
    visited: Set<Thing>
    done: boolean

    constructor(source: Thing, event: string, args: any, failed: boolean, visitFunc: (thing: Thing) => void, visitLinks = false) {
        this.tick = connection.tickCount
        this.source = source
        this.event = event
        this.failed = failed
        this.args = args
        this.visitFunc = visitFunc
        this.visitLinks = visitLinks
        this.visited = new Set()
        for (let i = 0; i < args.length; i++) {
            this[i] = args[i]
        }
    }
    /**
     * Propagate to a thing and its contents
     * If the thing is open, also propagate to its location
     * If this.visitLinks is true, also propagate through links
     */
    propagate(thing: Thing) {
        const world = this.source.world

        if (this.done || !thing || this.visited.has(thing)) return
        this.visited.add(thing)
        this.visitFunc(thing, this)
        for (const item of thing.refs.location) {
            this.propagate(item)
        }
        if (this.visitLinks) {
            for (const item of thing.refs.linkOwner) {
                const otherLink = thing.assoc.otherLink
                const otherThing = otherLink && otherLink.assoc.linkOwner

                this.propagate(otherLink)
                this.propagate(otherThing)
            }
        }
        if (!thing._closed || this.ignoreClosed) return this.propagate(thing.assoc.location)
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

    constructor(thing?: Thing) {
        this.created = []
        this.thing = thing
        this.outputHandler = () => { }
        const con = this
        this.pending = []
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
        this.error(`You don't see any ${thing} here`)
    }
    output(text: string) {
        if ((!this.suppressOutput && this.muted < 1) || this.failed) {
            this.outputHandler(text.match(/^</) ? text : `<div>${text}</div>`)
        }
    }
    withResultsSync(otherCon: MudConnection, func: () => void) {
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
    }
    withResults(otherCon: MudConnection, func: () => void) {
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
    }
    async start() {
        if (!this.remote) {
            this.world.watcher = t => this.checkTicker(t)
            for (const thing of this.world.thingCache.values()) {
                this.checkTicker(thing)
            }
        }
        mudTracker.setValue(MudState.Playing)
        this.outputHandler(`Welcome to ${this.world.name}, use the "login" command to log in.
<p>
<p>
<p>Help lists commands...
<p>
<p>Click on old commands to reuse them`)
        await this.world.start()
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
    dumpName(tip: thingId | Thing) {
        const thing = this.world.getThing(tip)

        return thing ? this.formatName(thing, true, true) : 'null'
    }
    formatName(thing: Thing, esc = false, verbose = this.verboseNames) {
        let output = thing._thing.formatName()

        if (esc) output = escape(output)
        if (verbose) {
            output += `<span class='thing'>(%${thing.id})</span>`
        }
        return output
    }
    formatDumpProperty(thing: Thing, prop: string, noParens = false) {
        const inherited = !(noParens || thing.hasOwnProperty('_' + prop))

        return `<span class='property${inherited ? ' inherited' : ''}'><span class='hidden input-text'>@set %${thing.id} ${prop} ${escape(thing['_' + prop])}</span>${prop}</span>`
    }
    formatDumpMethod(thing: Thing, prop: string, noParens = false) {
        const inherited = !(noParens || thing.hasOwnProperty('!' + prop))
        const [args, body] = JSON.parse(thing['!' + prop]._code)

        return `<span class='method${inherited ? ' inherited' : ''}'><span class='hidden input-text'>@method %${thing.id} ${prop} ${escape(args)} ${escape(body)}</span>${prop}</span>`
    }
    basicFormat(tip: thingId | Thing, str: string, args: Thing[]) {
        if (!str) return str
        const thing = tip instanceof Thing ? tip : this.world.getThing(tip)
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
                    case 'this': {
                        let name: string

                        if (thing === this.thing) {
                            name = 'you'
                        } else {
                            name = this.formatName(thing)
                        }
                        result += capitalize(name, format)
                        continue
                    }
                    case 'name': {
                        result += thing.name
                        continue
                    }
                    case 'is': {
                        result += thing && thing === this.thing ? 'are' : 'is'
                        continue
                    }
                    case 's': {
                        if (!thing || thing !== this.thing) {
                            result += (result.match(/\sgo$/) ? 'es' : 's')
                        }
                        continue
                    }
                    case 'location': {
                        result += capitalize(this.formatName(thing.assoc.location?._thing), format)
                        continue
                    }
                    case 'owner': {
                        result += capitalize(this.formatName(thing.assoc.linkOwner?._thing), format)
                        continue
                    }
                    case 'link': {
                        const other = thing.assoc.otherLink?._thing
                        const dest = other?.assoc.linkOwner?._thing

                        if (dest) {
                            result += capitalize(this.formatName(dest), format)
                        }
                        continue
                    }
                    case 'contents': {
                        const contents = thing.refs.location

                        if (contents.length) {
                            for (const item of contents) {
                                result += `<br>&nbsp;&nbsp;${this.format(item, thing.contentsFormat)}`
                            }
                            result += '<br>'
                        }
                        continue
                    }
                    case 'links': {
                        const links = thing.refs.linkOwner

                        if (links.length) {
                            for (const item of links) {
                                result += `<br>&nbsp;&nbsp;${this.format(item, item.linkFormat)}`
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
    description(thing: Thing) {
        return this.format(thing, thing.description)
    }
    examination(thing: Thing) {
        const result = this.description(thing)

        return result + (thing.examineFormat ? `<br>${this.format(thing, thing.examineFormat)}` : '')
    }
    describe(thing: Thing) {
        this.output(this.description(thing))
    }
    checkCommand(prefix: string, cmd: string, thing: any, checkLocal = cmd === thing.name) {
        return (checkLocal && (thing['_' + prefix] || thing['!' + prefix]))
            || thing[`_${prefix}_${cmd}`]
            || thing[`!${prefix}_${cmd}`]
    }
    findCommand(words: string[], prefix = 'cmd') {
        const result = this.findTemplate(words, prefix)

        if (result) {
            const [context, template] = result

            return this.substituteCommand(template, [`%${context.id}`, ...words])
        }
    }
    findTemplate(words: string[], prefix: string) {
        const cmd = words[0].toLowerCase()
        let template: string

        for (const item of (this.thing.refs.location) as any[]) {
            template = this.checkCommand(prefix, cmd, item)
            if (template) {
                return [item, template]
            }
        }
        if (!template) {
            for (const item of (this.thing.refs.linkOwner) as any[]) {
                template = this.checkCommand(prefix, cmd, item)
                if (template) {
                    return [item, template]
                }
            }
        }
        if (!template) {
            const loc = this.thing.assoc.location?._thing

            template = this.checkCommand(prefix, cmd, loc)
            if (template) {
                return [loc, template]
            } else {
                for (const item of (loc.refs.linkOwner) as any[]) {
                    template = this.checkCommand(prefix, cmd, item)
                    if (template) {
                        return [item, template]
                    }
                }
            }
        }
    }
    substituteCommand(template: any, args: any[]) {
        if (typeof template === 'string') {
            const lines = []
            const words = args.map(a => a instanceof Thing ? `%${a.id}` : a)

            for (const line of template.split(/\n/)) {
                const parts = line.split(/( *\$\w*)/)
                let newCmd = ''

                for (const part of parts) {
                    const match = part.match(/^( *)\$([0-9]+)$/)

                    if (match) {
                        const [_, space, format] = match

                        newCmd += space
                        newCmd += words[Number(format)]
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
    runCommands(lines: (string | CommandContext)[] | (() => any)) {
        const oldSubstituting = this.substituting

        try {
            this.substituting = true
            if (Array.isArray(lines)) {
                for (const line of lines) {
                    if (line instanceof CommandContext) {
                        line.run()
                    } else {
                        this.command(line, true)
                    }
                    if (this.failed) break
                }
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
            this.failed = false
        })
            .catch(err => {
                console.log(err)
                this.error(err.message)
            })
        if (this.thing?.name !== this.myName) {
            this.myName = this.thing.name
            mudproto.userThingChanged(this.thing)
        }
    }
    command(line: string, substituted = false, user = false) {
        const originalLine = line
        if (!line.trim()) return
        if (line[0] === '"' || line[0] === "'") {
            line = `say ${line.substring(1)}`
        } else if (line[0] === ':') {
            line = `act ${line.substring(1)}`
        } else if (line[0] === '%' && this.admin) {
            line = `@dump ${line}`
        } else if (line[0] === '!') {
            line = `@js ${line.substring(1)}`
        }
        const words = splitQuotedWords(line)
        const commandName = words[0].toLowerCase()

        if (!substituted) {
            this.output('<div class="input">&gt; <span class="input-text">' + escape(originalLine) + '</span></div>')
            if (!this.commands.has(commandName) && this.thing) {
                const newCommands = this.findCommand(words)

                if (newCommands) return this.runCommands(newCommands)
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
                this.world.update(() => this[command.method]({ command, line, substituted }, ...words.slice(1)))
                return true
            } finally {
                if (this.muted === 0) this.muted = muted
                if (!substituted) this.suppressOutput = false
            }
        } else {
            this.error('Unknown command: ' + words[0])
        }
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
    find(name: string, start: Thing = this.thing, errTag: string = '', subst = false): Thing {
        let result: Thing

        start = start?._thing
        if (!name) return null
        name = name.trim().toLowerCase()
        if (name[0] !== '%' || this.admin || this.substituting || subst) {
            if (name === 'out' || name === '%out') {
                const location = this.thing.assoc.location?._thing

                result = location && location.assoc.location?._thing
                if (!result || result === this.world.limbo) {
                    throw new Error('You are not in a container')
                }
            } else {
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
                                                        : start.find(name[0] === '%' ? name.slice(1) : name, this.thing.isIn(this.world.limbo) ? new Set() : new Set([this.world.limbo]))
            }
        }
        result = result?._thing
        if (!result && errTag) throw new Error(`Could not find ${errTag}: ${name}`)
        if (result instanceof Thing) this.world.stamp(result)
        return result
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
        let realProp

        if (!thing) {
            this.error('Could not find thing ' + thingStr)
            return []
        } else if (lowerProp === 'id') {
            this.error('Cannot change id!')
            return []
        } else if (lowerProp === '_proto__') {
            this.error('Cannot change __proto__!')
            return []
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
                    value = dropArgs(3, cmd)
                    break
            }
        } else {
            realProp = '_' + property
            value = dropArgs(3, cmd)
        }
        return [thing, lowerProp, realProp, value, propMap]
    }
    async doLogin(user: string, password: string, name: string, noauthentication = false) {
        try {
            await this.world.doTransaction(async () => {
                const oldThing = this.thing
                const [thing, admin] = await this.world.authenticate(user, password, name, noauthentication)

                this.user = user
                this.thing = thing
                this.myName = thing.name
                //this.myName = thing.name
                this.admin = admin
                this.verboseNames = admin
                connectionMap.set(this.thing, this)
                if (oldThing && oldThing !== this.thing) connectionMap.delete(oldThing)
                this.output(`Connected, you are logged in as ${user}.
<br>You can use the login command to change users...
<br><br>`)
                mudproto.userThingChanged(this.thing)
                thing.assoc.location = this.world.lobby
                this.commandDescripton(this.thing, 'has arrived', 'go', [this.world.limbo, this.world.lobby])
                // tslint:disable-next-line:no-floating-promises
                this.look(null, null)
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
            const desc = new Descripton(actor, event, args, !succeeded, thing => {
                const con = connectionMap.get(thing)

                if (con) {
                    con.withResultsSync(this, () => {
                        // run format in each connection so it can deal with admin and names
                        const format = con.basicFormat(actionContext, action, actionArgs)
                        const text = prefix ? `${capitalize(con.formatName(this.thing))} ${format}` : format

                        con.output(text)
                    })
                } else {
                    // process reactions in the main MudConnection
                    connection.react(thing, desc)
                }
            })

            if (!startAt) startAt = this.thing.assoc.location?._thing
            if (excludeActor) desc.visited.add(actor)
            desc.propagate(startAt)
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
        let con = connectionMap.get(thing)

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
                    const tick = new Descripton(null, 'tick', [], false, () => { })

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
            this.output(this.description(thing))
            return this.formatDescripton(null, 'looks at $arg', [thing], 'look', [thing])
        }
    }
    // COMMAND
    examine(cmdInfo, target?) {
        if (!target) {
            this.error(`What do you want to examine ? `)
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
        if (!cmdInfo.substituted) {
            const cmd = this.findCommand([directionStr, 'me'], 'go')
            if (cmd) return this.runCommands(cmd)
        }
        const oldLoc = this.thing.assoc.location?._thing
        let direction = this.find(directionStr, this.thing, 'direction')
        if (!direction) throw new Error(`Go where?`)
        direction = direction._thing
        let location: Thing
        const linkOwner = direction.assocId.linkOwner
        let tmp = direction
        const visited = new Set<Thing>()

        while (tmp !== this.world.limbo) {
            if (visited.has(tmp)) throw new Error(`${this.formatName(direction)} is in a circularity`)
            visited.add(tmp)
            if (tmp === this.thing) {
                throw new Error('You cannot go into something you are holding')
            }
            tmp = linkOwner in tmp.assoc ? tmp.assoc.linkOwner._thing : tmp.assoc.location?._thing
        }
        if (!linkOwner) {
            location = direction?._thing
            const oldPx = this.world.propertyProximity(oldLoc, '_contentsExitFormat')
            const newPx = this.world.propertyProximity(location, '_contentsEnterFormat')
            const emitter = newPx >= oldPx ? location : oldLoc
            const ctx = formatContexts(newPx >= oldPx ? location._contentsEnterFormat : oldLoc._contentsExitFormat)
            this.world.update(() => this.thing.assoc.location = location)
            ctx.others && this.formatDescripton(emitter, ctx.others, [this.thing, oldLoc, location], 'go', [oldLoc, location], true, true, true, this.thing)
            ctx.me && this.basicFormat(emitter, ctx.me, [this.thing, oldLoc, location])
            ctx.others && this.formatDescripton(emitter, ctx.others, [this.thing, oldLoc, location], 'go', [oldLoc, location], true, true, true, this.thing)
        } else {
            let link = direction.assoc.otherLink?._thing

            if (link) {
                link = link._thing
                const dest = link.assoc.linkOwner?._thing

                if (!dest) {
                    return this.error(`${directionStr} does not lead anywhere`)
                }
                location = dest._thing
            }
            const output = this.formatMe(direction, direction._linkMoveFormat, this.thing, oldLoc, location)
            const exitCtx = formatContexts(direction._linkExitFormat)
            exitCtx.others && this.formatDescripton(direction, exitCtx.others, [this.thing, oldLoc, location], 'go', [oldLoc, location], true, false)
            this.world.update(() => { this.thing.assoc.location = location })
            output && this.output(output)
            const enterCtx = formatContexts(direction._linkEnterFormat)
            if (link) {
                this.formatDescripton(link, enterCtx.others, [this.thing, oldLoc, location], 'go', [oldLoc, location], true, false)
            }
        }
        this.look(cmdInfo)
    }
    // COMMAND
    inventory(cmdInfo) {
        this.output(`<code>You are carrying\n${indent(3, (this.thing.refs.location).map(item => this.formatName(item)).join('\n'))}</code>`)
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
    get(cmdInfo, thingStr, ...args: Thing[]) {
        const location = this.thing.assoc.location?._thing
        let loc = location
        let newCommands: (string | CommandContext)[]

        if (args.length) {
            const [_, name] = findSimpleName(args.join(' '))

            loc = this.find(name, loc)
            if (!loc) return this.errorNoThing(name)
        }
        const thing = this.find(thingStr, loc)
        if (thing && thing.isIn(this.thing)) {
            return this.error(`You are already holding ${this.formatName(thing)}`)
        } else if (thing && !cmdInfo.substituted) {
            const cmd = this.checkCommand('get', thingStr, thing, true)
            if (cmd) newCommands = this.substituteCommand(cmd, [`%${thing.id}`, ...dropArgs(1, cmdInfo).split(/\s+/)])
        }
        if (!newCommands && !thing && !cmdInfo.substituted) {
            newCommands = (this.findCommand(dropArgs(1, cmdInfo).split(/\s+/), 'get')) as any
        }
        if (newCommands) return this.runCommands(newCommands)
        if (!thing) return this.errorNoThing(thingStr)
        if (thing === this.thing) return this.error(`You just don't get yourself. Some people are that way.`)
        if (thing === location) return this.error(`You just don't get this place. Some people are that way.`)
        thing.assoc.location = this.thing
        this.output(`You pick up ${this.formatName(thing)}`)
        return this.commandDescripton(thing, 'picks up $this', 'get', [thing])
    }
    // COMMAND
    drop(cmdInfo, thingStr) {
        const thing = this.find(thingStr, this.thing)
        const loc = this.thing.assoc.location?._thing

        if (!thing) return this.errorNoThing(thingStr)
        if (!thing.isIn(this.thing)) return this.error(`You aren't holding ${thingStr}`)
        thing.assoc.location = loc
        this.output(`You drop ${this.formatName(thing)}`)
        return this.commandDescripton(thing, 'drops $this', 'drop', [thing])
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

        if (!thing) return this.errorNoThing(thingStr)
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

        if (!thing) return this.errorNoThing(thingStr)
        this.formatDescripton(this.thing, '$quote <i>$this ${text} at $arg</i>', [thing], 'act', [text, thing], true, false, false)
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
            this.error(`<pre>Could not find prototype ${protoStr}
Prototypes:
${protos.join('\n  ')}`)
        } else {
            const fullname = dropArgs(2, cmdInfo)
            const thing = this.world.createThing(fullname)

            thing.setPrototype(proto)
            this.created.push(thing)
            if (this.created.length > 100) this.created = this.created.slice(this.created.length - 50)
            if (thing._prototype === this.world.roomProto.id) {
                this.output(`You created a room: ${this.dumpName(thing)}`)
            } else if (thing._prototype === this.world.linkProto.id) {
                this.output(`You created a link: ${this.dumpName(thing)}`)
            } else {
                thing.assoc.location = this.thing
                this.output(`You are holding your new creation: ${this.dumpName(thing)}`)
            }
        }
    }
    // COMMAND
    getPrototype(name: string) {
        return this.find(name, this.world.hallOfPrototypes, `${name} prototype`)
    }
    // COMMAND
    atLink(cmdInfo, loc1Str, exit1Str, exit2Str, loc2Str) {
        checkArgs(cmdInfo, arguments)
        const loc1 = this.find(loc1Str, this.thing, 'location1')
        const loc2 = this.find(loc2Str, this.thing, 'location2')
        const linkProto = this.getPrototype('link')
        const exit1 = this.world.createThing(exit1Str)
        const exit2 = this.world.createThing(exit2Str)

        exit1.name = exit1Str
        exit1.setPrototype(linkProto)
        exit1.assoc.linkOwner = loc1
        exit1.assoc.otherLink = exit2
        exit2.name = exit2Str
        exit2.setPrototype(linkProto)
        exit2.assoc.linkOwner = loc2
        exit2.assoc.otherLink = exit1
        this.output(`Linked ${this.dumpName(loc1)}->${this.dumpName(exit1)}--${this.dumpName(exit2)}<-${this.dumpName(loc2)}`)
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
                this.output(`Deleted function ${thingStr}.${prop}`)
            } else {
                this.error(`No function ${thingStr}.${prop}`)
            }
        } else {
            const match = code.match(/^\s*(\([^()]*\))((?:.|\s)*)$/)

            if (!match) {
                this.error(`Bad syntax, expected @method thing property (args) body`)
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
            this.error(`No function ${thingStr}.${prop}`)
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
    atDump(cmdInfo, thingStr) {
        checkArgs(cmdInfo, arguments)
        const thing = this.find(thingStr)
        if (!thing) return this.error('could not find ' + thingStr)
        console.log('DUMPING ', thing)
        const spec = thing.spec()
        const myKeys = new Set(Object.keys(thing).filter(k => !reservedProperties.has(k) && k[0] === '_'))
        const allKeys = []
        const fp = (prop, noParens = false) => this.formatDumpProperty(thing, prop, noParens)
        const fm = (prop, noParens = false) => this.formatDumpMethod(thing, prop, noParens)
        let result = `<span class='code'>${this.dumpName(thing)}
${fp('prototype', true)}: ${thing._prototype ? this.dumpName(thing.world.getThing(thing._prototype)) : 'none'}
${fp('location', true)}--> ${this.dumpName(thing.assocId.location)}
${fp('linkOwner', true)}--> ${this.dumpName(thing.assoc.linkOwner)}
${fp('otherLink', true)}--> ${this.dumpName(thing.assoc.otherLink)}
<--(location)--${this.dumpThingNames(thing.refs.location)}
<--(linkOwner)--${ this.dumpThingNames(thing.refs.linkOwner)}`

        for (const prop in thing) {
            if (prop === '_associations' || prop === '_associationThings') continue
            if (prop[0] === '_' && !reservedProperties.has(prop)) {
                allKeys.push(prop)
            } else if (prop[0] === '!') {
                allKeys.push(prop)
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
            if (k === 'location' || k === 'linkOwner' || k === 'otherLink') continue
            if (!associationMap.has(k)) associationMap.set(k, new Set())
            associationMap.get(k).add(this.world.getThing(v))
        }
        const associations = Array.from(associationMap.keys())
        associations.sort()
        for (const key of associations) {
            result += `\n   ${fp(key)} --> ${Array.from(associationMap.get(key)).map(t => this.formatName(t)).join(' ')} `
        }
        const backlinks = new Map<string, Thing[]>()
        for (const associate of thing.assoc.refs()) {
            for (const [k, v] of associate._associations) {
                if (k === 'location' || k === 'linkOwner' || k === 'otherLink' || v !== thing.id) continue
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
    // COMMAND
    atOutput(cmdInfo: any /*, actor, text, arg..., @event, actor, event, arg...*/) {
        const words = splitQuotedWords(dropArgs(1, cmdInfo))
        // tslint:disable-next-line:prefer-const
        let [contextStr, text] = words
        if (text[0] === '"') text = JSON.parse(text)
        const ctx = formatContexts(text)
        const context = this.find(contextStr, undefined, 'context')
        const evtIndex = words.findIndex(w => w.toLowerCase() === '@event')
        if (evtIndex === -1 || words.length - evtIndex < 3) {
            throw new Error('@output needs @event actor eventType')
        }
        // tslint:disable-next-line:prefer-const
        let [actorStr, ...eventArgs] = words.slice(evtIndex + 1)
        const actor = this.find(actorStr, undefined, 'actor')
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
        if (ctx.others) {
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
        }
    }
    // COMMAND
    atMove(cmdInfo: any, thingStr: string, locStr: string) {
        const thing = this.find(thingStr)
        const loc = this.find(locStr)

        if (!thing) return this.error(`Could not find ${thingStr} `)
        if (!loc) return this.error(`Could not find ${locStr} `)
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
        return con.command(cmd, false, true)
    }
    // COMMAND
    atAdmin(cmdInfo: any, thingStr: string, toggle: string) {
        checkArgs(cmdInfo, arguments)
        const thing = this.find(thingStr)
        if (!thing) return this.error(`Could not find ${thingStr} `)
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
    atAdd(cmdInfo: any, thingStr: string, property: string, thing2Str: string) {
        checkArgs(cmdInfo, arguments)
        const thing = this.find(thingStr, this.thing, 'thing')
        const thing2 = this.find(thing2Str, this.thing, 'thing2')
        const prop = '_' + property.toLowerCase()

        if (!Array.isArray(thing[prop]) && !addableProperties.has(prop)) {
            return this.error(`${property} is not a list`)
        }
        if (!thing[prop]) {
            thing[prop] = [thing2.id]
        } else if (thing[prop].indexOf(thing2.id) === -1) {
            if (!thing.hasOwnProperty(prop)) thing[prop] = thing[prop].slice()
            thing[prop].push(thing2.id)
            this.output(`Added ${thing2Str} to ${property} `)
        } else {
            this.error(`${thing2Str} is already in ${property} `)
        }
    }
    // COMMAND
    atRemove(cmdInfo: any, thingStr: string, property: string, thing2Str: string) {
        checkArgs(cmdInfo, arguments)
        const thing = this.find(thingStr, this.thing, 'thing')
        const thing2 = this.find(thing2Str, this.thing, 'thing2')
        const prop = '_' + property.toLowerCase()

        if (!Array.isArray(thing[prop]) && !addableProperties.has(prop)) {
            this.error(`${property} is not a list`)
        }
        const index = thing[prop].indexOf(thing2.id)
        if (index !== -1) {
            thing[prop].splice(index, 1)
            this.output(`Removed ${thing2Str} from ${property} `)
        } else {
            this.error(`${thing2Str} is not in ${property} `)
        }
    }
    // COMMAND
    atReproto(cmdInfo: any, thingStr: string, protoStr: string) {
        checkArgs(cmdInfo, arguments)
        const thing = this.find(thingStr, this.thing, 'thing')
        const proto = this.find(protoStr, this.thing, 'prototype');
        (thing as any).__proto__ = proto
        thing._prototype = proto.id
        this.output(`You changed the prototype of ${this.formatName(thing)} to ${this.formatName(proto)} `)
    }
    // COMMAND
    atInstances(cmdInfo: any, protoStr: string) {
        const proto = this.find(protoStr, this.thing, 'prototype');
        let result = `< pre > Instances of ${this.formatName(proto)}: `

        for (const inst of this.world.getInstances(proto)) {
            result += `\n   ${this.formatName(inst)} `
        }
        this.output(result + '</pre>')
    }
    // COMMAND
    atSetBigInt(cmdInfo: any, thingStr: string, property: string, value: string) {
        checkArgs(cmdInfo, arguments)
        return this.atSet(cmdInfo, thingStr, property, BigInt(value))
    }
    // COMMAND
    atSetBool(cmdInfo: any, thingStr: string, property: string, value: string) {
        checkArgs(cmdInfo, arguments)
        return this.atSet(cmdInfo, thingStr, property, Boolean(value))
    }
    // COMMAND
    atSetNum(cmdInfo: any, thingStr: string, property: string, value: string) {
        checkArgs(cmdInfo, arguments)
        return this.atSet(cmdInfo, thingStr, property, Number(value))
    }
    // COMMAND
    atSet(cmdInfo: any, thingStr: string, property: string, value: any) {
        checkArgs(cmdInfo, arguments)
        const [thing, lowerProp, realProp, val] = this.thingProps(thingStr, property, value, cmdInfo)
        value = val
        if (!thing) return
        if (addableProperties.has(realProp)) return this.error(`Cannot set ${property} `)
        switch (lowerProp) {
            case 'react_tick':
                thing._react_tick = String(value)
                this.checkTicker(thing)
                break
            case 'count':
                thing.count = Number(value)
                break
            case 'fullname': {
                thing.fullName = value
                break
            }
            case 'location': {
                const location = this.find(value)

                if (!location) {
                    this.error('Could not find location ' + value)
                    return
                }
                thing.assoc.location = location
                break
            }
            case 'linkowner':
                const owner = this.find(value)

                if (!owner) {
                    this.error('Could not find link owner ' + value)
                    return
                }
                thing.assoc.linkOwner = owner
                break
            case 'otherlink':
                const other = this.find(value)

                if (!other) {
                    this.error('Could not find other link ' + value)
                    return
                }
                thing.assoc.otherLink = other
                break
            case 'prototype':
                const proto = this.find(value, this.world.hallOfPrototypes)

                if (!proto) {
                    this.error('Could not find prototype ' + value)
                    return
                }
                thing.setPrototype(proto)
                break
            default:
                if (value instanceof Thing) value = value.id
                thing[realProp] = value
                break
        }
        this.output(`set ${thingStr} ${property} to ${value} `)
    }
    atCopy(cmdInfo: any, thingStr: string, force: string) {
        checkArgs(cmdInfo, arguments)
        const connected = new Set<Thing>()
        const thing = this.find(thingStr, this.thing, 'thing') as Thing

        thing.findConnected(connected)
        this.checkConnected(thingStr, connected, force && force.toLowerCase() === 'force')
        const newThing = thing.copy(connected) as Thing
        this.created.push(newThing)
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
    atToast(cmdInfo: any, thingStr: string) {
        checkArgs(cmdInfo, arguments)
        const things = this.findAll([...arguments].slice(1), this.thing, 'thing')
        let out = ''
        const all = new Set<Thing>()

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
            this.error(`Could not find ${thingStr} `)
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
            this.error(`Could not find ${thingStr}`)
        }
    }
    // COMMAND
    atDel(cmdInfo, thingStr, property) {
        checkArgs(cmdInfo, arguments)
        const [thing, lowerProp, realProp, value, propMap] = this.thingProps(thingStr, property, undefined, cmdInfo)

        if (!thing) return
        if (!propMap.has(lowerProp)) {
            return this.error('Bad property: ' + property)
        }
        if (reservedProperties.has(realProp) || addableProperties.has(realProp)) {
            return this.error('Reserved property: ' + property)
        }
        delete thing[realProp]
        this.checkTicker(thing)
        this.output(`deleted ${property} from ${thing.name}`)
    }
    // COMMAND
    atFind(cmdInfo, target, startStr) {
        checkArgs(cmdInfo, arguments)
        const start = startStr ? this.find(startStr, this.thing, 'location') : this.thing
        const thing = this.find(target, start, 'target')

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
            return this.error(`Command not found: ${cmd}`)
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
                return this.output(`<pre>${helpText(argLen, command)}</pre>`)
            }
        }
        cmds.sort()
        for (const name of cmds) {
            const command = this.commands.get(name)

            if (command.alt) continue
            if (result) result += '\n'
            result += helpText(argLen, command)
        }
        this.output('<pre>' + result + `

You can use <b>me</b> for yourself, <b>here</b> for your location, and <b>out</b> for your location's location (if you're in a container)${this.admin ? adminHelp : ''}</pre>`)
    }
}
MudConnection.prototype.commands = initCommands(commands)


function splitQuotedWords(line: string) {
    return line.split(wordAndQuotePat).filter(x => x) // discard empty strings
}

function helpText(argLen: number, command: any) {
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
            result += indent(argLen - args.length, '') + '  --  ' + command.help[i + 1]
        }
    }
    return result
}

function indent(spaceCount: number, str: string) {
    let spaces = ''

    for (let i = 0; i < spaceCount; i++) {
        spaces += ' '
    }
    return str.replace(/(^|\n)/g, '$1' + spaces)
}

function dropArgs(count: number, cmdInfo: any) {
    return cmdInfo.line.split(/( +)/).slice(count * 2).join('')
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
    const tmp: any = {}

    if (contexts.length > 1) {
        for (let i = 1; i < contexts.length; i += 2) {
            tmp[contexts[i].trim().substring(1).toLowerCase()] = contexts[i + 1]
        }
        if (tmp.forme && !tmp.forothers) tmp.forothers = contexts[0]
        if (!tmp.forme && tmp.forothers) tmp.forme = contexts[0]
        return {
            me: tmp.forme,
            others: tmp.forothers,
        }
    }
    return { others: contexts[0], me: contexts[0] }
}

function thingPxy(item: any): any {
    return !(item instanceof Thing) ? item : item._thing.specProxy
}

function pxyThing(item: any): any {
    return !(item instanceof Thing) ? item : (item as any)._thing || item
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
        mudproto.command(text)
    }
}

export async function runMud(world: World, handleOutput: (str: string) => void) {
    activeWorld = world
    world.mudConnectionConstructor = MudConnection
    connection = createConnection(world, handleOutput)
    console.log(connection)
    await connection.start()
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
