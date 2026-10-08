import { type ChapterReadData } from './data.js';
import { type ChapterReadCallbacks } from './callbacks.js';
export interface ChapterReadState extends ChapterReadData, ChapterReadCallbacks {}
