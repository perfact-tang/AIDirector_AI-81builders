import { app } from './app.js';
import express from 'express';
import path from 'node:path';
app.use(express.static('dist'));
app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
app.listen(3001, '127.0.0.1', () => console.log('Director API: http://127.0.0.1:3001'));
