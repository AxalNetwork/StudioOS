#!/bin/bash
cd frontend && npx vite build
touch ../docs/.nojekyll
echo "axal.vc" > ../docs/CNAME

cat > ../docs/404.html << 'SPAEOF'
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

INDEXFILE="../docs/index.html"
if ! grep -q "replaceState" "$INDEXFILE"; then
  sed -i 's|</title>|</title>\n  <meta name="description" content="Axal Ventures — From Idea to Funded Company in 30 Days. The operating system for venture creation." />\n  <script type="text/javascript">\n    (function(l) {\n      if (l.search[1] === '"'"'/'"'"' ) {\n        var decoded = l.search.slice(1).split('"'"'\&'"'"').map(function(s) { \n          return s.replace(/~and~/g, '"'"'\&'"'"')\n        }).join('"'"'?'"'"');\n        window.history.replaceState(null, null,\n            l.pathname.slice(0, -1) + decoded + l.hash\n        );\n      }\n    }(window.location))\n  </script>|' "$INDEXFILE"
fi

echo "Build complete! docs/ is ready for GitHub Pages."
echo "Push to GitHub and set Pages source to: main branch, /docs folder"
