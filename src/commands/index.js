import { Collection } from 'discord.js';
import botstart from './botstart.js';
import botstop from './botstop.js';

const commands = new Collection();
commands.set(botstart.data.name, botstart);
commands.set(botstop.data.name, botstop);

export default commands; 