// Platform-specific utility code, only on PC/NodeJS platform
import * as fs from 'fs';

export const rmSync = fs.rmSync;
