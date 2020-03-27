import * as gui from './gui.js';
var app;
var connection;
const commands = new Set(['login']);
export function init(appObj) {
    app = appObj;
}
export class MudConnection {
    constructor(world, outputHandler) {
        this.world = world;
        this.outputHandler = outputHandler;
    }
    configure(user, thing) {
        this.user = user;
        this.thing = thing;
    }
    output(text) {
        this.outputHandler(text);
    }
    start() {
        this.outputHandler('Welcome to the mud, use the "login" command to log in...');
    }
    command(text) {
        var cmd = text.split(/\s+/);
        if (commands.has(cmd[0])) {
            this[cmd[0]](...cmd.slice(1));
        }
        else {
            this.output('Unknown command: ' + cmd[0]);
        }
    }
    login(user, password) {
        alert('Logging in as ' + user + ' with password: ' + password);
    }
}
export function runMud(world) {
    connection = new MudConnection(world, text => gui.addMudOutput('<div>' + text + '</div>'));
    connection.start();
}
export function command(text) {
    if (connection) {
        connection.command(text);
    }
}
//# sourceMappingURL=mudcontrol.js.map