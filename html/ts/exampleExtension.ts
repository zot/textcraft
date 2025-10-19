import {
    Thing,
    World,
} from "./model"
import {
    Command,
    initCommands,
    MudConnection,
    spliceConnection,
} from "./mudcontrol"

const floopCommands = new Map([
    ['floop', new Command({ help: ['', 'You floop around'] })]
])

class FloopConnection extends MudConnection {
    async floop(cmdInfo) {
        this.output('You floop around')
        return this.commandDescripton(null, 'floops around', 'floop', [])
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
