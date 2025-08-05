import { Collection } from 'discord.js';
import activationBotstart from './activation-botstart.js';
import activationBotstop from './activation-botstop.js';

const activationCommands = new Collection();
activationCommands.set(activationBotstart.data.name, activationBotstart);
activationCommands.set(activationBotstop.data.name, activationBotstop);

export default activationCommands; 