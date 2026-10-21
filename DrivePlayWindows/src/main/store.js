'use strict';

const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const ALLOWED = new Set(['library', 'progress', 'settings', 'recents']);

function dataDirectory() {
  const directory = app.getPath('userData');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function fileFor(name) {
  if (!ALLOWED.has(name)) throw new Error(`Store inválido: ${name}`);
  return path.join(dataDirectory(), `${name}.json`);
}

async function load(name) {
  try {
    const raw = await fsp.readFile(fileFor(name), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    console.error(`DrivePlay: não foi possível ler ${name}.json`, error);
    return null;
  }
}

async function save(name, data) {
  const target = fileFor(name);
  const temporary = `${target}.tmp`;
  const raw = JSON.stringify(data, null, 2);
  await fsp.writeFile(temporary, raw, 'utf8');
  await fsp.rename(temporary, target);
}

module.exports = { load, save, dataDirectory, fileFor };
