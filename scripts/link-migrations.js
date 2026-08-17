const fs = require("fs");
const path = require("path");

// Each module keeps its own migrations next to its code. Knex needs them all
// in one directory to run, so this collects them into ./migrations before
// any migrate/seed command runs. Symlinks are preferred (single source of
// truth); if the OS/user lacks symlink permission, it falls back to a copy.
const centralMigrationsDir = path.join(__dirname, "..", "migrations");
const modulesDir = path.join(__dirname, "..", "src/modules");

const createLinks = () => {
  if (!fs.existsSync(centralMigrationsDir)) {
    fs.mkdirSync(centralMigrationsDir, { recursive: true });
  }

  const modules = fs.readdirSync(modulesDir);
  console.log(`Found modules: ${modules.join(", ")}`);

  modules.forEach((module) => {
    const moduleMigrationDir = path.join(modulesDir, module, "migrations");
    if (!fs.existsSync(moduleMigrationDir)) return;

    const migrationFiles = fs.readdirSync(moduleMigrationDir);
    migrationFiles.forEach((file) => {
      const source = path.join(moduleMigrationDir, file);
      const destination = path.join(centralMigrationsDir, file);

      if (fs.existsSync(destination)) {
        const stats = fs.lstatSync(destination);
        if (stats.isSymbolicLink() || stats.isFile()) {
          fs.unlinkSync(destination);
        }
      }

      try {
        fs.symlinkSync(source, destination, "file");
        console.log(`Linked: ${module}/${file}`);
      } catch (err) {
        fs.copyFileSync(source, destination);
        console.log(`Copied (symlink unavailable): ${module}/${file}`);
      }
    });
  });
};

createLinks();
