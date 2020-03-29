import {
    MudState,
    mudTracker,
} from './base.js'
import {
    World,
    Thing,
    thingId,
} from './model.js'
import * as gui from './gui.js'

var yaml = (window as any).jsyaml
var app: any
var connection: MudConnection

const reservedProperties = new Set([
    '_id',
    '_prototype',
    '_location',
    '_contents',
    '_links',
    '_linkOwner',
    '_otherLink',
    '__proto__',
])

const properties = [
    'prototype',
    'article',
    'name',
    'count',
    'location',
    'description',
    'linkOwner',
    'otherLink',
]
const lowercaseProperties = properties.map(p=> p.toLowerCase())
const setHelp = [
    'thing property value', `Set one of these properties on a thing:
  prototype   -- see the @info command
  article     -- the article for a thing's name
  name        -- the thing's fullName (the name will be set to the first word)
  count       -- how many there are of the thing (defaults to 1)
  location    -- move the thing to another location
  linkowner   -- set the thing's linkOwner
  otherlink   -- set the thing's otherLink 
  description -- the thing's description, you can use the following format words in a description (if you capitalize a format word, the substitution will be capitalized), :
     \$is       -- is or are, depending on the thing's count (does not capitalize)
     \$s        -- optional s, if count is 1 (like run$s, does not capitalize)
     \$this     -- the thing
     \$links    -- the thing's links
     \$contents -- the thing's contents
     \$location -- the thing's location
     \$owner    -- the link's owner when the thing acts as a link
     \$link     -- the link's destination when the thing acts as a link
`
]

const commands = new Map<String, any>([
    ['help',        {help: ['','Show this message']}],
    ['login',       {help: ['user password', 'Login to the mud']}],
    ['look',        {help: ['', `See a description of your current location`,
                            'thing', 'See a description of a thing']}],
    ['go',          {help: ['location', `move to another location (may be a direction)`]}],
    ['@dump',       {help: ['thing', 'See properties of a thing']}],
    ['@create',     {help: ['proto', 'Create a thing']}],
    ['@find',       {help: ['thing', 'Find a thing',
                           'thing location', 'Find a thing from a location',]}],
    ['@link',       {help: ['loc1 link1 link2 exit2', 'create links between two things']}],
    ['@info',       {help: ['', 'List important information']}],
    ['@setNum',     {help: ['thing property number'], admin: true, alt: '@set'}],
    ['@setBigint',  {help: ['thing property bigint'], admin: true, alt: '@set'}],
    ['@setBool',    {help: ['thing property boolean'], admin: true, alt: '@set'}],
    ['@set',        {help: setHelp, admin: true}],
    ['@del',        {help: ['thing property', `Delete a properties from a thing so it will inherit from its prototype`]}],
])

export function init(appObj) {
    app = appObj
    console.log(yaml)
    for (let cmd of commands.keys()) {
        let command = commands.get(cmd)

        command.minArgs = 1000
        command.name = cmd
        if (command.alt) {
            let alt = commands.get(command.alt)

            if (!alt.alts) alt.alts = []
            commands.get(command.alt).alts.push(command)
        }
        if (cmd[0] == '@') {
            command.admin = true
        }
        for (let i = 0; i < command.help.length; i+= 2) {
            command.minArgs = Math.min(command.minArgs, command.help[i].split(/ +/).length)
        }
    }
}

export class Descripton {
    source: Thing
    visited: Set<Thing>

    propagate(thing: Thing) {
        if (this.visited.has(thing)) return
        this.visited.add(thing)
        this.visit(thing)
    }
    visit(thing: Thing) {}
}

export class Mud {
    world: World
    connections: MudConnection[]

    move(thing: Thing, location: Thing) {
        thing.setLocation(location)
    }
    link(thing: Thing, link: Thing, otherLink: Thing) {
        link.setLinkOwner(thing)
        if (otherLink) {
            link.setOtherLink(otherLink)
        }
    }
}

export class MudConnection {
    world: World
    user: string
    admin: boolean
    thing: Thing
    outputHandler: (output: string)=> void
    created: Thing[]
    constructor(world, outputHandler) {
        this.world = world
        this.outputHandler = outputHandler
        this.created = []
    }
    async configure(user: string, thing: thingId) {
        this.user = user
        this.thing = await this.world.getThing(thing)
    }
    error(text: string) {
        this.output('<div class="error">'+text+'</div>')
    }
    output(text: string) {
        this.outputHandler(text)
    }
    start() {
        mudTracker.setValue(MudState.Playing)
        this.outputHandler(`Welcome to the mud, use the "login" command to log in.
<p>
<p>
<p>Help lists commands...
<p>
<p>Click on old commands to reuse them`)
    }
    async format(tip: thingId | Thing | Promise<Thing>, str: string) {
        if (!str) return str
        var thing = await this.world.getThing(tip)
        var result =''
        var parts = str.split(/( *\$\w*)/)

        for (let part of parts) {
            var match = part.match(/^( *)\$(.*)$/)

            if (match) {
                var [_, space, format] = match

                result += space
                switch(format.toLowerCase()) {
                    case 'this' : {
                        var name: string

                        if (thing == this.thing) {
                            name = 'you'
                        } else {
                            name = thing.formatName()
                        }
                        result += capitalize(name, format)
                        continue
                    }
                    case 'is': {
                        result += thing && (thing.count != 1 || thing == this.thing) ? 'are' : 'is'
                        continue
                    }
                    case 's': {
                        result += !thing || thing.count == 1 ? 's' : ''
                        continue
                    }
                    case 'location': {
                        result += capitalize((await thing.getLocation()).formatName(), format)
                        continue
                    }
                    case 'owner': {
                        result += capitalize((await thing.getLinkOwner()).formatName(), format)
                        continue
                    }
                    case 'link': {
                        var other = await thing.getOtherLink()
                        var dest = await other?.getLinkOwner()

                        if (dest) {
                            result += capitalize(dest.formatName(), format)
                        }
                        continue
                    }
                    case 'contents': {
                        var contents = await thing.getContents()

                        if (contents.length) {
                            for (var item of contents) {
                                result += `<br>&nbsp;&nbsp;${await this.format(item, thing.contentsFormat)}`
                            }
                            result += '<br>'
                        }
                        continue
                    }
                    case 'links': {
                        var links = await thing.getLinks()

                        if (links.length) {
                            for (var item of links) {
                                result += `<br>&nbsp;&nbsp;${await this.format(item, item.linkFormat)}`
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
    async dumpName(tip: thingId | Thing | Promise<Thing>) {
        var thing = await this.world.getThing(tip)

        return escape(thing ? `%${thing._id} ${thing.formatName()}` : 'null')
    }
    description(thing: Thing) {
        return this.format(thing, thing.description)
    }
    async examination(thing: Thing) {
        var result = await this.description(thing)

        return result + (thing.examineFormat ? `<br>${await this.format(thing, thing.examineFormat)}` : '')
    }
    async describe(thing: Thing) {
        this.output(await this.description(thing))
    }
    command(line: string) {
        var cmd = line.split(/\s+/)

        cmd[0] == cmd[0].toLowerCase()
        if (this.thing ? commands.has(cmd[0]) : cmd[0] == 'login' || cmd[0] == 'help') {
            var command = commands.get(cmd[0])

            if (command.admin && !this.admin) {
                return this.error('Unknown command: '+cmd[0])
            }
            if (cmd[0][0] == '@') {
                cmd[0] = 'at' + capitalize(cmd[0].substring(1))
            }
            this.output('<span class="input">&gt; <span class="input-text">'+line+'</span></span>')
            // execute command inside a transaction so it will automatically store any dirty objects
            this.world.doTransaction(()=> this[cmd[0]]({command, line}, ...cmd.slice(1)))
                .catch(err=> this.error(err.message))
        } else {
            this.output('Unknown command: '+cmd[0])
        }
    }
    async find(name: string, start: Thing = this.thing, errTag: string = ''): Promise<Thing> {
        if (!name) return null
        name = name.trim().toLowerCase()
        var result: Thing = name == 'me' ? this.thing
            : name == 'here' ? await this.thing.getLocation()
            : name == '%limbo' ? await this.world.getThing(this.world.limbo)
            : name == '%lobby' ? await this.world.getThing(this.world.lobby)
            : name == '%protos' ? await this.world.getThing(this.world.hallOfPrototypes)
            : name.match(/^%proto:/) ? await (await this.world.getThing(this.world.hallOfPrototypes)).find(name.replace(/^%proto:/, ''))
            : name.match(/%-[0-9]+/) ? this.created[this.created.length - Number(name.substring(2))]
            : name.match(/%[0-9]+/) ? await this.world.getThing(Number(name.substring(1)))
            : await start.find(name)

        if (!result && errTag) {
            throw new Error(`Could not find ${errTag}: ${name}`)
        }
        return result
    }
    async dumpThingNames(things: Thing[]) {
        var items = []

        for (let item of things) {
            items.push(await this.dumpName(item))
        }
        return items.join(', ')
    }
    async thingProps(thingStr: string, property: string, value: any, cmd: any) {
        var thing = await this.find(thingStr)
        var propMap = new Map()
        var lowerProp = property.toLowerCase()
        var realProp

        if (!thing) {
            this.error('Could not find thing '+thingStr)
            return []
        } else if (lowerProp == 'id') {
            this.error('Cannot change id!')
            return []
        } else if (lowerProp == '_proto__') {
            this.error('Cannot change __proto__!')
            return []
        }
        for (let key of Object.keys(thing)) {
            if (key != '_id' && key[0] == '_') {
                propMap.set(key.substring(1).toLowerCase(), key)
            }
        }
        if (propMap.has(lowerProp)) {
            realProp = propMap.get(lowerProp)
            var curVal = thing[property]

            switch (typeof curVal) {
                case 'number':
                    value = Number(value)
                    break
                case 'boolean':
                    value = Boolean(value)
                    break
                case 'bigint':
                    value = BigInt(value)
                    break
                default:
                    value = dropArgs(3, cmd)
                    break
            }
        } else {
            realProp = '_'+property
            value = dropArgs(3, cmd)
        }
        return [thing, lowerProp, realProp, value, propMap]
    }
    ///
    /// COMMANDS
    ///
    async login(cmdInfo, user, password) {
        try {
            var [thing, admin] = await this.world.authenticate(user, password)

            this.user = user
            this.thing = thing
            this.admin = admin
            this.output('Connected.')
            return this.look(null, null)
        } catch (err) {
            this.error(err.message)
        }
    }
    async look(cmdInfo, target) {
        if (target) {
            var thing = await this.find(target, this.thing, 'object')

            this.output(await this.description(thing))
        } else {
            this.output(await this.examination(await this.thing.getLocation()))
        }
    }
    async go(cmdInfo, locationStr) {
        var location = await this.find(locationStr, this.thing, 'location')
        var link = location._otherLink && await location.getOtherLink()

        if (link) {
            location = link && await link.getLinkOwner()
            if (!location) {
                return this.error(`${locationStr} does not lead anywhere`)
            }
        }
        await this.thing.setLocation(location)
        this.output(`Moved ${link ? link.formatName() + ' to' : ''} ${location.formatName()}`)
    }
    async atCreate(cmdInfo, protoStr, name) {
        var proto = await this.find(protoStr, await this.world.getThing(this.world.hallOfPrototypes))

        if (!proto) {
            var hall = await this.world.getThing(this.world.hallOfPrototypes)
            var protos = []

            for (let proto of await hall.getContents()) {
                protos.push(`%${proto._id} %proto:${proto.name}`)
            }
            this.error(`<pre>Could not find prototype ${protoStr}
Prototypes:
  ${protos.join('\n  ')}`)
        } else {
            var thing = await this.world.createThing(name, dropArgs(3, cmdInfo))

            thing.setPrototype(proto)
            this.created.push(thing)
            if (this.created.length > 100) this.created = this.created.slice(this.created.length - 50)
            this.output(`Created ${await this.dumpName(thing)}`)
        }
    }
    async getPrototype(name: string) {
        return this.find(name, await this.world.getThing(this.world.hallOfPrototypes), `${name} prototype`)
    }
    async atLink(cmdInfo, loc1Str, exit1Str, exit2Str, loc2Str) {
        checkArgs(cmdInfo, arguments)
        var loc1 = await this.find(loc1Str, this.thing, 'location1')
        var loc2 = await this.find(loc2Str, this.thing, 'location2')
        var linkProto = await this.getPrototype('link')
        var exit1 = await this.world.createThing(exit1Str)
        var exit2 = await this.world.createThing(exit2Str)

        exit1.name = exit1Str
        exit1.setPrototype(linkProto)
        exit1.setLinkOwner(loc1)
        exit1.setOtherLink(exit2)
        exit2.name = exit2Str
        exit2.setPrototype(linkProto)
        exit2.setLinkOwner(loc2)
        exit2.setOtherLink(exit1)
        this.output(`Linked ${await this.dumpName(loc1)}->${await this.dumpName(exit1)}--${await this.dumpName(exit2)}<-${await this.dumpName(loc2)}`)
    }
    async atDump(cmdInfo, thingStr) {
        checkArgs(cmdInfo, arguments)
        var thing = await this.find(thingStr)
        if (!thing) return this.error('could not find '+thingStr)
        var spec = thing.spec()
        var myKeys = new Set(Object.keys(thing).filter(k=> !reservedProperties.has(k) && k[0] == '_'))
        var allKeys = []
        var result = `<pre>${await this.dumpName(thing)}
   prototype: ${thing._prototype ? await this.dumpName(await thing.world.getThing(thing._prototype)) : 'none'}
   location:  ${await this.dumpName(thing._location)}
   contents:  ${await this.dumpThingNames(await thing.getContents())}
   links:     ${await this.dumpThingNames(await thing.getLinks())}
   linkOwner: ${await this.dumpName(thing._linkOwner)}
   otherLink: ${await this.dumpName(thing._otherLink)}`

        for (let prop in thing) {
            if (prop[0] == '_' && !reservedProperties.has(prop)) {
                allKeys.push(prop)
            }
        }
        allKeys.sort()
        for (let prop of allKeys) {
            var propName = prop.substring(1)

            if (!myKeys.has(prop)) {
                propName = `(${propName})`
            }
            result += `\n   ${propName}: ${escape(thing[prop])}`
        }
        result += '</pre>'
        this.output(result)
    }
    atSetBigInt(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments)
        return this.atSet(cmdInfo, thingStr, property, BigInt(value))
    }
    atSetBool(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments)
        return this.atSet(cmdInfo, thingStr, property, Boolean(value))
    }
    atSetNum(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments)
        return this.atSet(cmdInfo, thingStr, property, Number(value))
    }
    async atSet(cmdInfo, thingStr, property, value) {
        checkArgs(cmdInfo, arguments)
        var [thing, lowerProp, realProp, value] = await this.thingProps(thingStr, property, value, cmdInfo)

        if (!thing) return
        switch (lowerProp) {
            case 'count':
                thing.count = Number(value)
                break
            case 'location': {
                var location = await this.find(value)

                if (!location) {
                    this.error('Could not find location '+value)
                    return
                }
                await thing.setLocation(location)
                break
            }
            case 'linkowner':
                var owner = await this.find(value)

                if (!owner) {
                    this.error('Could not find link owner '+value)
                    return
                }
                await thing.setLinkOwner(owner)
                break
            case 'otherlink':
                var other = await this.find(value)

                if (!other) {
                    this.error('Could not find other link '+value)
                    return
                }
                await thing.setOtherLink(other)
                break
            case 'prototype':
                var proto = await this.find(value, await this.world.getThing(this.world.hallOfPrototypes))

                if (!proto) {
                    this.error('Could not find prototype '+value)
                    return
                }
                await thing.setPrototype(proto)
                break
            default:
                thing.markDirty(thing[realProp] = value)
                break
        }
        this.output(`set ${thingStr} ${property} to ${value}`)
    }
    async atDel(cmdInfo, thingStr, property) {
        checkArgs(cmdInfo, arguments)
        var [thing, lowerProp, realProp, value, propMap] = await this.thingProps(thingStr, property, null, cmdInfo)

        if (!thing) return
        if (!propMap.has(lowerProp)) {
            return this.error('Bad property: '+property)
        }
        if (reservedProperties.has(propMap(lowerProp))) {
            return this.error('Reserved property: '+property)
        }
        delete thing[propMap.get(lowerProp)]
        thing.markDirty()
        this.output(`deleted ${property} from ${thing.name}`)
    }
    async atFind(cmdInfo, target, startStr) {
        checkArgs(cmdInfo, arguments)
        var start = startStr ? await this.find(startStr, this.thing, 'location') : this.thing
        var thing = await this.find(target, start, 'target')

        this.output(await this.dumpName(thing))
    }
    async atInfo() {
        var hall = await this.world.getThing(this.world.hallOfPrototypes)
        var protos = []

        for (let proto of await hall.getContents()) {
            protos.push(`%${proto._id} %proto:${proto.name}`)
        }
        this.output(
`<pre>Name: ${this.world.name}
Your user name: ${this.user}${this.admin ? ' (admin)' : ''}
You: ${await this.dumpName(this.thing)}
lobby: ${await this.dumpName(this.world.lobby)}
limbo: ${await this.dumpName(this.world.limbo)}
hall of prototypes: ${await this.dumpName(this.world.hallOfPrototypes)}

Prototypes:
  ${protos.join('<br>  ')}
</pre>`)
        }
    async atPrototypes() {
        var hall = await this.world.getThing(this.world.hallOfPrototypes)

        this.output(`Prototypes:<br><br>${(await hall.getContents()).map(t=> this.dumpName(t)).join('<br>')}`)
    }
    help(cmdInfo, cmd) {
        var cmds = [...commands.keys()].filter(k=> !commands.get(k).admin || this.admin)
        var result = ''
        var argLen = 0

        if (!this.thing) {
            cmds = ['help', 'login']
        }
        for (let name of cmds) {
            let help = commands.get(name).help

            for (let i = 0; i < help.length; i += 2) {
                argLen = Math.max(argLen, name.length + 1 + help[i].length)
            }
        }
        cmds.sort()
        for (let name of cmds) {
            var cmd = commands.get(name)

            if (cmd.alt) continue
            if (cmd.alts) {
                for (let alt of cmd.alts) {
                    if (result) result += '\n'
                    result += `<b>${alt.name} ${alt.help[0]}</b>`
                }
            }
            for (let i = 0; i < cmd.help.length; i += 2) {
                let args = name + ' ' + cmd.help[i]

                if (result) result += '\n'
                result += `<b>${args}</b>`
                if (cmd.help[i + 1]) {
                    result += indent(argLen - args.length, '') + '  --  ' + cmd.help[i + 1]
                }
            }
        }
        this.output('<pre>'+result+`

You can use <b>me</b> for yourself and <b>here</b> for your location${this.admin ? `
You can use %lobby, %limbo, and %protos for the standard rooms
You can use %proto:name for a prototype
You can use %NUMBER for an object by its ID (try <b>@dump me</b> for an example)
You can use %-N for an item you created recently (%-1 is the last item, %-2 is the next to last, etc.)` : ''}</pre>`)
    }
}

function helpText(key, cmd) {
    
}

function indent(spaces: number, str: string) {
    let indent = ''

    for (let i = 0; i < spaces; i++) {
        indent += ' '
    }
    return str.replace(/(^|\n)/g, '$1'+indent)
}

function dropArgs(count: number, cmdInfo: any) {
    return cmdInfo.line.split(/( +)/).slice(count * 2).join('')
}

export function capitalize(str: string, templateWord: string = '') {
    return !templateWord || templateWord[0].toUpperCase() == templateWord[0]
        ? str[0].toUpperCase() + str.substring(1)
        : str
}

export function runMud(world: World) {
    connection = new MudConnection(world, text=> gui.addMudOutput('<div>'+text+'</div>'))
    connection.start()
}

function checkArgs(cmdInfo: any, args: any) {
    check(args.length >= cmdInfo.command.minArgs + 1, 'Not enough arguments to '+cmdInfo.command.name)
}

function check(test: boolean, msg: string) {
    if (!test) throw new Error(msg)
}

export function command(text: string) {
    if (connection) {
        connection.command(text)
    }
}

export function escape(text: string) {
    return typeof text == 'string' ? text.replace(/</g, '&lt;') : text
}
