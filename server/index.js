import { app } from './app.js';
import express from 'express';
import path from 'node:path';
app.use(express.static('dist'));
app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
const port=Number(process.env.PORT)||3001;
app.listen(port,'0.0.0.0',()=>console.log(`Director listening on ${port}`));
