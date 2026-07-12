/* Throwaway diagnostic — deleted before commit. */
import mongoose from 'mongoose';
import { config } from './config';
import { ProjectModel } from './models';
import { renderSlidesToPng } from './lib/exporter';

async function main() {
  await mongoose.connect(config.mongoUri);
  const id = process.argv[2]!;
  const project = await ProjectModel.findById(id);
  try {
    const rendered = await renderSlidesToPng(project!.toJSON() as never);
    console.log('render ok:', rendered.length);
  } catch (e) {
    console.error('ERROR:', e);
  }
  await mongoose.disconnect();
  process.exit(0);
}
main();
