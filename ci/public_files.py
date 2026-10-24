"""The static publish boundary; build inputs and Python helpers are never served."""
from pathlib import PurePosixPath

STATIC_DIRS={'img','models','newbiz-stim','neurolens2'}
ROOT_DATA={'model-registry.json','release_policy.json','training-ledger.json','dataset-engine-log.json','dataset-evolution-log.json','robots.txt','sitemap.xml'}
ASSET_TYPES={'.html','.js','.mjs','.css','.json','.png','.jpg','.jpeg','.webp','.svg','.ico','.woff','.woff2','.wasm','.task','.onnx'}

def publishable(name):
    path=PurePosixPath(name)
    if any(part.startswith('.') for part in path.parts) or '.test.' in path.name or path.name.startswith('NeuroLens_PRD_'):
        return False
    if name in {'index.html.html','neurolens2/operational-baseline.json','newbiz-stim/02scape.png'} or any(part.startswith('generation-report-') for part in path.parts):
        return False
    if len(path.parts)==1:
        return path.suffix in {'.html','.js','.css'} or name in ROOT_DATA
    return path.parts[0] in STATIC_DIRS and (path.suffix in ASSET_TYPES or path.name=='MEDIAPIPE-LICENSE.txt')
