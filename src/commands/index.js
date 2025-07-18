import { Collection } from 'discord.js';
import botresume from './botresume.js';

const commands = new Collection();
commands.set(botresume.data.name, botresume);

export default commands; 