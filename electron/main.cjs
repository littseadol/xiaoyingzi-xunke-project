if (process.env.XY_LOCAL_MODE === '1') require('./local.cjs');
else require('./cloud.cjs');
