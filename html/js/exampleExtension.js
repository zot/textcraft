import { Command, initCommands, MudConnection, spliceConnection, } from "/js/mudcontrol.js";
const floopCommands = new Map([
    ['floop', new Command({ help: ['', 'You floop around'] })]
]);
class FloopConnection extends MudConnection {
    async floop(cmdInfo) {
        this.output('You floop around');
        return this.commandDescripton(null, 'floops around', 'floop', []);
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