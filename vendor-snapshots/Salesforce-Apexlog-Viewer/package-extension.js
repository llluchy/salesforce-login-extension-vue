
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectDir = __dirname;
const manifestPath = path.join(projectDir, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
const zipFileName = `salesforce-log-extension-v${version}.zip`;
const outputPath = path.join(projectDir, zipFileName);

console.log(`\n📦 开始打包 Salesforce Log Extension v${version}`);
console.log('=========================================');

// 删除旧的 zip 文件
if (fs.existsSync(outputPath)) {
  fs.unlinkSync(outputPath);
  console.log(`✅ 删除旧版本: ${zipFileName}`);
}

// 定义要打包的文件和文件夹
const filesToZip = [
  'manifest.json',
  'background.js',
  'icons',
  'window'
];

// 创建 zip 命令
const zipCommand = `cd "${projectDir}" && zip -r "${zipFileName}" ${filesToZip.join(' ')} -x "*.DS_Store" "node_modules/*" ".git/*" ".trae/*" "*.log" "*.md" "package*.json" "generate-icons.js" "package-extension.js"`;

try {
  execSync(zipCommand, { encoding: 'utf8' });
  
  const stats = fs.statSync(outputPath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  
  console.log(`✅ 打包完成: ${zipFileName}`);
  console.log(`📁 文件大小: ${fileSizeMB} MB`);
  console.log(`📍 输出位置: ${outputPath}`);
  console.log('\n✅ 在 Chrome 中安装: 打开 chrome://extensions/，开启"开发者模式"，点击"加载已解压的扩展程序"选择项目文件夹，或直接拖入 zip 文件\n');
  
} catch (error) {
  console.error('❌ 打包失败:', error.message);
  process.exit(1);
}

