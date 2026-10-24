const path = location.pathname.replace(/\/$/, '');
if (['/output', '/render', '/left', '/right'].includes(path)) import('./output.js');
else import('./main.js');
