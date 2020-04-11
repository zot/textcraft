import { Command, initCommands, MudConnection, spliceConnection, } from "/js/mudcontrol.js";
const floopCommands = new Map([
    ['floop', new Command({ help: ['', 'You floop around'] })]
]);
class FloopConnection extends MudConnection {
    floop(cmdInfo) {
        this.output('You floop around');
        this.commandDescripton('floops around');
    }
}
FloopConnection.prototype.commands = initCommands(floopCommands);
spliceConnection(FloopConnection);
function onStarted(world, con) {
    console.log('Mud started up', world, con);
}
function onLoggedIn(user, thing) {
    console.log('Host logged in', user, thing);
}
//# sourceMappingURL=exampleExtension.js.map