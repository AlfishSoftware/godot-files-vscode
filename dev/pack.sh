#!/usr/bin/env bash
publisher=$(node -p "require('./package.json').publisher")
name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")
vsix="./build/$publisher.$name-$version.dev.vsix"
npm ci &&
vsce package --out "$vsix" --githubBranch develop &&
unzip -l -vqq "$vsix" | awk '{print $8}'
