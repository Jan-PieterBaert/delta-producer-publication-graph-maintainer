import _ from 'lodash';
import { updateSudo as update } from '@lblod/mu-auth-sudo';
import fs from 'fs-extra';
import { query, sparqlEscapeDateTime, uuid } from 'mu';
import { storeError } from '../lib/utils';

const SHARE_FOLDER = '/share';

export default class DeltaCache {

  constructor() {
    this.cache = [];
  }

  /**
   * Push new entries to the delta cache
   *
   * @public
  */
  push() {
    this.cache.push(...arguments);
  }

  /**
   * Write current state of the delta cache to a file
   *
   * @public
  */
  async generateDeltaFile(_config) {
    if (this.cache.length) {
      const cachedArray = [ ...this.cache ];
      this.cache = [];

      const chunkedArray = chunkCache(_config, cachedArray);
      for(const [ index, entry ] of chunkedArray.entries()) {
        try {
          const folderDate = new Date();
          const subFolder = folderDate.toISOString().split('T')[0];
          const outputDirectory = `${SHARE_FOLDER}/${_config.RELATIVE_FILE_PATH}/${subFolder}`;
          fs.mkdirSync(outputDirectory, { recursive: true });

          const filename = `delta-${new Date().toISOString()}-${index}.json`;
          const filepath = `${outputDirectory}/${filename}`;

          if(_config.PRETTY_PRINT_DIFF_JSON){
            await fs.writeFile(filepath, JSON.stringify( entry, null, 2 ));
          }
          else {
            await fs.writeFile(filepath, JSON.stringify( entry ));
          }

          console.log(`Delta cache has been written to file. Cache contained ${entry.length} items.`);

          await this.writeFileToStore(_config, filename, filepath);
          console.log("File is persisted in store and can be consumed now.");

        } catch (e) {
          await storeError(_config, e);
        }
      }
    } else {
      console.log("Empty cache. Nothing to save on disk");
    }
  }

  /**
   * Get all delta files produced since a given timestamp
   *
   * @param _config the configuration to be used
   * @param since {string} ISO date time
   * @public
  */
  async getDeltaFiles(_config, since) {
    console.log(`Retrieving delta files since ${since}`);

    const result = await query(`
    ${_config.PREFIXES}

    SELECT ?uuid ?filename ?created WHERE {
      ?s a nfo:FileDataObject ;
          mu:uuid ?uuid ;
          nfo:fileName ?filename ;
          dct:publisher <${_config.PUBLISHER_URI}> ;
          dct:created ?created .
      ?file nie:dataSource ?s .

      FILTER (?created > "${since}"^^xsd:dateTime)
    } ORDER BY ?created
  `);

    return result.results.bindings.map(b => {
      return {
        type: 'files',
        id: b['uuid'].value,
        attributes: {
          name: b['filename'].value,
          created: b['created'].value
        }
      };
    });
  }

  /**
   * @private
   */
  async writeFileToStore(_config, filename, filepath) {
    const virtualFileUuid = uuid();
    const virtualFileUri = `http://data.lblod.info/files/${virtualFileUuid}`;
    const nowLiteral = sparqlEscapeDateTime(new Date());
    const physicalFileUuid = uuid();
    const physicalFileUri = filepath.replace(SHARE_FOLDER, 'share://');

    await update(`
    ${_config.PREFIXES}

    INSERT DATA {
      GRAPH <${_config.FILES_GRAPH}> {
        <${virtualFileUri}> a nfo:FileDataObject ;
          mu:uuid "${virtualFileUuid}" ;
          nfo:fileName "${filename}" ;
          dct:format "application/json" ;
          dbpedia:fileExtension "json" ;
          dct:created ${nowLiteral} ;
          dct:modified ${nowLiteral} ;
          dct:publisher <${_config.PUBLISHER_URI}> .
        <${physicalFileUri}> a nfo:FileDataObject ;
          mu:uuid "${physicalFileUuid}" ;
          nie:dataSource <${virtualFileUri}> ;
          nfo:fileName "${filename}" ;
          dct:format "application/json" ;
          dbpedia:fileExtension "json" ;
          dct:created ${nowLiteral} ;
          dct:modified ${nowLiteral} .
      }
    }
  `, { 'mu-call-scope-id': _config.MU_CALL_SCOPE_ID_PUBLICATION_GRAPH_MAINTENANCE });
  }
}

/**
 * Chunks the cached array, to not exploded memory when writing to json
 * @param _config the configuration to be used
 * @param cache: [ { inserts: [], deletes: [] }, { inserts: [], deletes: [] } ]
 * @return [ [ { inserts: [], deletes: [] } ], [ { inserts: [], deletes: [] } ] ]
 */
function chunkCache( _config, cache ) {
  const allChunks = [];
  for(const entry of cache){

    //results in [ [<uri_1>, ..., <uri_n>], [<uri_1>, ..., <uri_n>] ]
    const insertChunks = _.chunk(entry.inserts, _config.CACHE_CHUNK_STATEMENT);
    const deleteChunks = _.chunk(entry.deletes, _config.CACHE_CHUNK_STATEMENT);

    if(deleteChunks.length > 1 || insertChunks.length > 1 ){
      for(const deleteChunk of deleteChunks){
        const chunk = { inserts: [], deletes: deleteChunk };
        allChunks.push(chunk);
      }

      for(const insertChunk of insertChunks){
        const chunk = { inserts: insertChunk, deletes: [] };
        allChunks.push(chunk);
      }
    }
    else {
      allChunks.push(entry);
    }
  }
  return _.chunk(allChunks, _config.CACHE_CHUNK_ARRAY);
}
