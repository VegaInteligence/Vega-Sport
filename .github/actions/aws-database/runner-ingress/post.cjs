require('./index.cjs').run('close').catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
