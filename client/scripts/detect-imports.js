// Finds top-level (non-relative, non-@alias) package imports in src and prints package names
const fs = require('fs');
const path = require('path');

function walk(dir) {
    let files = [];
    for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        const stat = fs.statSync(p);
        if (stat.isDirectory()) files = files.concat(walk(p));
        else if (/\.(js|jsx|ts|tsx)$/.test(p)) files.push(p);
    }
    return files;
}

try {
    if (!fs.existsSync('src')) {
        console.error('No src directory found');
        process.exit(1);
    }
    const files = walk('src');
    const pkgSet = new Set();
    const importRe = /import\s+(?:[^'";]+from\s+)?['"]([^'"]+)['"]/g;
    const requireRe = /require\(['"]([^'"]+)['"]\)/g;

    for (const f of files) {
        const s = fs.readFileSync(f, 'utf8');
        let m;
        while ((m = importRe.exec(s))) {
            const mod = m[1];
            if (!mod.startsWith('.') && !mod.startsWith('/') && !mod.startsWith('@/')) {
                const name = mod.startsWith('@') ? mod.split('/').slice(0,2).join('/') : mod.split('/')[0];
                pkgSet.add(name);
            }
        }
        // also handle require(...) usages
        while ((m = requireRe.exec(s))) {
            const mod = m[1];
            if (!mod.startsWith('.') && !mod.startsWith('/') && !mod.startsWith('@/')) {
                const name = mod.startsWith('@') ? mod.split('/').slice(0,2).join('/') : mod.split('/')[0];
                pkgSet.add(name);
            }
        }
    }

    console.log([...pkgSet].sort().join('\n'));
} catch (err) {
    console.error(err);
    process.exit(1);
}