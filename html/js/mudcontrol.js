import { MudState, mudTracker, } from './base.js';
import * as gui from './gui.js';
var yaml = window.jsyaml;
var app;
var connection;
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
const commands = new Map([
    ['help', { help: 'help                      -- Show this message' }],
    ['login', { help: 'login user password       -- Login to the mud' }],
    ['look', { help: `look                      -- See a description of your current location
look thing                      -- See a description of a thing` }],
    ['@dump', { help: '@dump thing               -- See properties of a thing' }],
    ['@create', { help: '@create proto             -- Create a thing' }],
    ['@info', { help: '@info                     -- List important information' }],
    ['@set', { help: `@set thing property value -- Set one of these properties on a thing:
  prototype   -- see the @info command
  article     -- the article for a thing's name
  name        -- the thing's fullName (the name will be set to the first word)
  count       -- how many there are of the thing (defaults to 1)
  location    -- move the thing to another location
  linkowner   -- set the thing's linkOwner
  otherlink   -- set the thing's otherLink 
  description -- the thing's description, you can use the following format words in a description:
     \$This -- capitalized formatted name
     \$this -- uncapitalized formatted name
     \$is   -- is or are, depending on the thing's count
     \$s    -- optional s, if count is 1 (like run$s)
     \$Here -- capitalized formatted name of the thing's location
     \$here -- uncapitalized formatted name of the thing's location
`, admin: true }],
    ['@del', { help: `@del thing property       -- Delete one of these properties from a thing so it will inherit from its prototype:
     article
     name
     fullName
     description
     count` }],
]);
export function init(appObj) {
    app = appObj;
    console.log(yaml);
    for (let cmd of commands.keys()) {
        if (cmd[0] == '@') {
            commands.get(cmd).admin = true;
        }
    }
}
export class Descripton {
    propagate(thing) {
        if (this.visited.has(thing))
            return;
        this.visited.add(thing);
        this.visit(thing);
    }
    visit(thing) { }
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
    }
    async configure(user, thing) {
        this.user = user;
        this.thing = await this.world.getThing(thing);
    }
    error(text) {
        this.output('<div class="error">' + text + '</div>');
    }
    output(text) {
        this.outputHandler(text);
    }
    start() {
        mudTracker.setValue(MudState.Playing);
        this.outputHandler(`Welcome to the mud, use the "login" command to log in.
<p>
<p>
<p>Help lists commands...
<p>
<p>Click on old commands to reuse them`);
    }
    async format(tip, str) {
        if (!str)
            return str;
        var thing = await this.world.getThing(tip);
        var result = '';
        var parts = str.split(/( *\$\w*)/);
        for (let part of parts) {
            var match = part.match(/^( *)\$(.*)$/);
            if (match) {
                var [_, space, format] = match;
                result += space;
                switch (format) {
                    case 'This':
                    case 'this': {
                        var name;
                        if (thing == this.thing) {
                            name = 'you';
                        }
                        else {
                            name = thing.formatName();
                        }
                        if (format == 'This') {
                            name = capitalize(name);
                        }
                        result += name;
                        continue;
                    }
                    case 'is': {
                        result += !thing || thing.count == 1 ? 'is' : 'are';
                        continue;
                    }
                    case 's': {
                        result += !thing || thing.count == 1 ? 's' : '';
                        continue;
                    }
                    case 'Here':
                    case 'here': {
                        var name = (await this.thing.getLocation()).formatName();
                        if (format == 'Here') {
                            name = capitalize(name);
                        }
                        result += name;
                        continue;
                    }
                }
            }
            result += part;
        }
        return result;
    }
    async dumpName(tip) {
        var thing = await this.world.getThing(tip);
        return thing ? `%${thing._id} ${await thing.formatName()}` : 'null';
    }
    async describe(thing) {
        var desc = await this.format(thing, thing.description);
        var contents = await thing.getContents();
        if (contents.length) {
            desc += '<br>';
            for (var thing of contents) {
                desc += `<br>${thing == this.thing ? 'You are' : thing.formatName() + ' is'} here`;
            }
        }
        this.output(desc);
    }
    command(text) {
        var cmd = text.split(/\s+/);
        cmd[0] == cmd[0].toLowerCase();
        if (this.thing ? commands.has(cmd[0]) : cmd[0] == 'login' || cmd[0] == 'help') {
            if (commands.get(cmd[0]).admin && !this.admin) {
                return this.error('Unknown command: ' + cmd[0]);
            }
            if (cmd[0][0] == '@') {
                cmd[0] = 'at' + capitalize(cmd[0].substring(1));
            }
            this.output('<span class="input">&gt; <span class="input-text">' + text + '</span></span>');
            // execute command inside a transaction so it will automatically store any dirty objects
            this.world.doTransaction(async () => this[cmd[0]](text, ...cmd.slice(1)))
                .catch(err => this.error(err.message));
        }
        else {
            this.output('Unknown command: ' + cmd[0]);
        }
    }
    async find(name, start = this.thing) {
        if (!name)
            return null;
        name = name.trim().toLowerCase();
        return name == 'me' ? this.thing
            : name == 'here' ? await this.thing.getLocation()
                : name.match(/%[0-9]+/) ? await this.world.getThing(Number(name.substring(1)))
                    : start.find(name);
    }
    async dumpContents(thing) {
        var items = [];
        for (let item of await thing.getContents()) {
            items.push(await this.dumpName(item));
        }
        return items.join(', ');
        //        return (await thing.getContents()).map(async t=> await this.dumpName(t)).join(', ')
    }
    ///
    /// COMMANDS
    ///
    async login(line, user, password) {
        try {
            var [thing, admin] = await this.world.authenticate(user, password);
            this.user = user;
            this.thing = thing;
            this.admin = admin;
            this.output('Connected.');
            this.look();
        }
        catch (err) {
            this.error(err.message);
        }
    }
    async look() {
        this.describe(await this.thing.getLocation());
    }
    async atCreate(line, proto, name) {
        var proto = await this.find(proto, await this.world.getThing(this.world.hallOfPrototypes));
        if (!proto) {
            this.error('Could not find prototype ' + proto);
        }
        else {
            var thing = await this.world.createThing(name, dropArgs(3, line));
            thing.setPrototype(proto);
            this.output(`Created ${await this.dumpName(thing)}`);
        }
    }
    async atDump(line, thingStr) {
        checkArgs(2, arguments, '@dump');
        var thing = await this.find(thingStr);
        if (!thing)
            return this.error('could not find ' + thingStr);
        var spec = thing.spec();
        this.output(`<pre>%${thing.id}
   name: ${thing._name}
   prototype: ${thing._prototype ? await this.dumpName(await thing.world.getThing(thing._prototype)) : 'none'}
   fullName: ${thing._fullName}
   article: ${thing._article}
   description: ${thing._description}
   count: ${thing._count}
   location: ${await this.dumpName(thing._location)}
   contents: ${await this.dumpContents(thing)}
   linkOwner: ${await this.dumpName(thing._linkOwner)}
   otherLink: ${await this.dumpName(thing._otherLink)}
   open: ${thing._open}</pre>`);
    }
    async atSet(line, thingStr, property, value) {
        var thing = await this.find(thingStr);
        if (!thing) {
            this.error('Could not find thing ' + thingStr);
            return;
        }
        switch (property.toLowerCase()) {
            case 'article':
                thing.article = value;
                break;
            case 'name':
                thing.fullName = value;
                break;
            case 'description':
                thing.description = dropArgs(3, line);
                break;
            case 'count':
                thing.count = Number(value);
                break;
            case 'location': {
                var location = await this.find(value);
                if (!location) {
                    this.error('Could not find location ' + value);
                    return;
                }
                await thing.setLocation(location);
                break;
            }
            case 'linkowner':
                var owner = await this.find(value);
                if (!owner) {
                    this.error('Could not find link owner ' + value);
                    return;
                }
                await thing.setLinkOwner(owner);
                break;
            case 'otherlink':
                var other = await this.find(value);
                if (!other) {
                    this.error('Could not find other link ' + value);
                    return;
                }
                await thing.setOtherLink(other);
                break;
            case 'prototype':
                var proto = await this.find(value);
                if (!proto) {
                    this.error('Could not find prototype ' + value);
                    return;
                }
                await thing.setPrototype(proto);
                break;
            default:
                this.error('Unknown property: ' + property);
        }
        this.output(`set ${thingStr} ${property} to ${value}`);
    }
    async atDel(line, name, property) {
        var thing = await this.find(name);
        var propIndex = lowercaseProperties.indexOf(property.toLowerCase());
        if (!thing) {
            this.error('Could not find thing ' + name);
            return;
        }
        if (propIndex == -1) {
            this.error('Bad property name ' + property);
            return;
        }
        delete thing[properties[propIndex]];
    }
    async atInfo() {
        var hall = await this.world.getThing(this.world.hallOfPrototypes);
        var protos = [];
        for (let proto of await hall.getContents()) {
            protos.push(await this.dumpName(proto));
        }
        this.output(`<pre>Name: ${this.world.name}
Your user name: ${this.user}${this.admin ? ' (admin)' : ''}
You: ${await this.dumpName(this.thing)}
lobby: ${await this.dumpName(this.world.lobby)}
limbo: ${await this.dumpName(this.world.limbo)}
hall of prototypes: ${await this.dumpName(this.world.hallOfPrototypes)}

${protos.join('<br>')}
</pre>`);
    }
    async atPrototypes() {
        var hall = await this.world.getThing(this.world.hallOfPrototypes);
        this.output(`Prototypes:<br><br>${(await hall.getContents()).map(t => this.dumpName(t)).join('<br>')}`);
    }
    help(line, cmd) {
        if (!this.thing) {
            this.output(`<pre>${commands.get('help').help}
${commands.get('login').help}</pre>`);
            return;
        }
        var cmds = [...commands.keys()];
        var result = '';
        cmds.sort();
        for (let name of cmds) {
            var cmd = commands.get(name);
            if (!cmd.admin || this.admin) {
                if (result) {
                    result += '\n';
                }
                result += cmd.help;
            }
        }
        this.output('<pre>' + result + `

You can use <b>me</b> for yourself and <b>here</b> for your location</pre>
${this.admin ? 'You can use %NUMBER to refer to an object by its ID (try <b>@dump me</b> for an example)' : ''}`);
    }
}
function helpText(key, cmd) {
}
function indent(spaces, str) {
    let indent = '';
    for (let i = 0; i < spaces; i++) {
        indent += ' ';
    }
    return str.replace(/(^|\n)/g, '$1' + indent);
}
function dropArgs(count, text) {
    return text.split(/( +)/).slice(count * 2).join('');
}
export function capitalize(str) {
    return str[0].toUpperCase() + str.substring(1);
}
export function runMud(world) {
    connection = new MudConnection(world, text => gui.addMudOutput('<div>' + text + '</div>'));
    connection.start();
}
function checkArgs(count, args, command) {
    check(count == args.length, 'Not enough arguments to ' + command);
}
function check(test, msg) {
    if (!test)
        throw new Error(msg);
}
export function command(text) {
    if (connection) {
        connection.command(text);
    }
}
//# sourceMappingURL=mudcontrol.js.map