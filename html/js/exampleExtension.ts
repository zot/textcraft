import {
    Thing,
    World,
} from "/js/model.js"
import {
    Command,
    initCommands,
    MudConnection,
    spliceConnection,
} from "/js/mudcontrol.js"

const floopCommands = new Map([
    ['floop', new Command({ help: ['', 'You floop around'] })]
])

class FloopConnection extends MudConnection {
    floop(cmdInfo) {
        this.output('You floop around')
        this.commandDescripton('floops around')
    }
}
FloopConnection.prototype.commands = initCommands(floopCommands)

spliceConnection(FloopConnection)

function onStarted(world: World, con: MudConnection) {
    console.log('Mud started up', world, con)
}

function onLoggedIn(user: any, thing: Thing) {
    console.log('Host logged in', user, thing)
}
