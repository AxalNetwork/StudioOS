#!/bin/bash
set -e

echo "Building React app for GitHub Pages..."
cd frontend && npx vite build
cd ..

touch docs/.nojekyll
echo "axal.vc" > docs/CNAME

cat > docs/404.html << 'SPAEOF'
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Axal VC — StudioOS</title>
  <script type="text/javascript">
    var pathSegmentsToKeep = 0;
    var l = window.location;
    l.replace(
      l.protocol + '//' + l.hostname + (l.port ? ':' + l.port : '') +
      l.pathname.split('/').slice(0, 1 + pathSegmentsToKeep).join('/') + '/?/' +
      l.pathname.slice(1).split('/').slice(pathSegmentsToKeep).join('/').replace(/&/g, '~and~') +
      (l.search ? '&' + l.search.slice(1).replace(/&/g, '~and~') : '') +
      l.hash
    );
  </script>
</head>
<body></body>
</html>
SPAEOF

INDEXFILE="docs/index.html"
if ! grep -q "replaceState" "$INDEXFILE"; then
  sed -i '/<\/title>/a\  <meta name="description" content="Axal Ventures — From Idea to Funded Company in 30 Days." />\n  <script type="text/javascript">(function(l){if(l.search[1]==="/"){var decoded=l.search.slice(1).split("\&").map(function(s){return s.replace(/~and~/g,"\&")}).join("?");window.history.replaceState(null,null,l.pathname.slice(0,-1)+decoded+l.hash)}}(window.location))</script>' "$INDEXFILE"
fi

cp docs/index.html ./index.html
cp docs/404.html ./404.html
cp -r docs/assets/ ./assets/
cp docs/.nojekyll ./.nojekyll
cp docs/CNAME ./CNAME

echo ""
echo "Build complete! Files ready for GitHub Pages at both / and /docs."
echo "Push to GitHub — Pages serves from main branch, / (root)."
