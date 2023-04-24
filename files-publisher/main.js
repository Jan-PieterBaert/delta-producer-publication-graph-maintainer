import DeltaCache from './delta-cache';
import { storeError } from '../lib/utils';

const cache = new DeltaCache();
let hasTimeout = null;

export async function publishDeltaFiles( _config, delta ){
  if((delta.inserts.length || delta.deletes.length)){
    if (_config.LOG_INCOMING_DELTA) {
      console.log(`Receiving delta ${JSON.stringify(delta)}`);
    }

    const processDelta = async function() {
      try {

        if (_config.LOG_OUTGOING_DELTA) {
          console.log(`Pushing onto cache ${JSON.stringify(delta)}`);
        }

        cache.push( delta );

        if( !hasTimeout ){
          triggerTimeout(_config);
        }
      }
      catch(e){
        console.error(`General error processing delta ${e}`);
        await storeError(_config, e);
      }
    };
    processDelta();  // execute async to batch published data in files
  }
}

export async function getDeltaFiles( _config, since ){
  since = since || new Date().toISOString();
  const files = await cache.getDeltaFiles(_config, since);
  return files;
}

function triggerTimeout(_config){
  setTimeout( () => {
    try {
      hasTimeout = false;
      cache.generateDeltaFile(_config);
    }
    catch(e){
      console.error(`Error generating delta file ${e}`);
      storeError(e);
    }
  }, _config.DELTA_INTERVAL );
  hasTimeout = true;
}

// TODO write the in-memory delta cache to a file before shutting down the service
