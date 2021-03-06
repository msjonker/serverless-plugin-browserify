'use strict';

const BbPromise  = require('bluebird'),
      os         = require('os'),
      browserify = require('browserify'),
      path       = require('path'),
      fs         = BbPromise.promisifyAll(require('fs-extra')),
      _          = require('lodash'),
      archiver   = require('archiver');

module.exports = {
  bundle(functionName) {
    let functionObject           = this.serverless.service.getFunction(functionName);
    const outputDir              = this.options.out || path.join(os.tmpdir(), functionName),
        functionBrowserifyConfig = this.getFunctionConfig(functionName),
        finalZipFilePath         = path.resolve(path.join(outputDir, '..', `${functionName}.zip`));

    let b = browserify(functionBrowserifyConfig);

    this.serverless.cli.log(`Bundling ${functionName} with Browserify...`);

    if (process.env.SLS_DEBUG) {
      this.serverless.cli.log(`Writing browserfied bundle to ${outputDir}`);
    }

    fs.emptyDirSync(outputDir);

    functionBrowserifyConfig.exclude.forEach(file => b.exclude(file));
    functionBrowserifyConfig.ignore.forEach(file => b.ignore(file));

    return new BbPromise((resolve, reject) => {
      b.bundle((err, bundledBuf) => {
        if (err) {
          return reject(err);
        }

        const handlerPath = path.join(outputDir, functionObject.handler.split('.')[0] + '.js');

        fs.mkdirsSync(path.dirname(handlerPath), '0777');  //handler may be in a subdir
        fs.writeFile(handlerPath, bundledBuf, (err)=> {
          (err) ? reject(err) : resolve();
        });
      });
    })
      .then(()=> {
        if (process.env.SLS_DEBUG) {
          this.serverless.cli.log(`Zipping ${outputDir} to ${finalZipFilePath}`);
        }

        return zipDir(outputDir, finalZipFilePath);
      })
      .then((sizeBytes)=> {
        const fileSizeInMegabytes = sizeBytes / 1000000.0;
        this.serverless.cli.log(`Created ${functionName}.zip (${Math.round(fileSizeInMegabytes * 100) / 100} MB)...`);

        if (!functionObject.package) {
          functionObject.package = {};
        }

        //This is how we tell Serverless to not do any bunding or zipping
        //@see https://serverless.com/framework/docs/providers/aws/guide/packaging/#artifact
        functionObject.package.artifact = finalZipFilePath;
      });
  },
};

function zipDir(dirPath, destZipFilePath) {
  return new BbPromise((resolve, reject) => {
    let output  = fs.createWriteStream(destZipFilePath);
    let archive = archiver.create('zip');

    output.on('close', () => {
      resolve(archive.pointer());
    });

    archive.on('error', (err) => reject(err));

    archive.pipe(output);
    archive
      .append('empty so lambda inline editor does not show', {name: 'empty.txt'})
      .directory(dirPath, '')
      .finalize();
  });
}
