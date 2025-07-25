import * as fs from 'fs';
import * as path from 'path';
import { ISynthesisSession } from './types';
import * as cxschema from '../../../cloud-assembly-schema';
import { FileAssetSource, FileAssetPackaging, DockerImageAssetSource } from '../assets';
import { UnscopedValidationError } from '../errors';
import { resolvedOr } from '../helpers-internal/string-specializer';
import { Stack } from '../stack';
import { Token } from '../token';
import { contentHash } from './_shared';

/**
 * Build an asset manifest from assets added to a stack
 *
 * This class does not need to be used by app builders; it is only necessary for building Stack Synthesizers.
 */
export class AssetManifestBuilder {
  private readonly files: NonNullable<cxschema.AssetManifest['files']> = {};
  private readonly dockerImages: NonNullable<cxschema.AssetManifest['dockerImages']> = {};

  /**
   * Add a file asset to the manifest with default settings
   *
   * Derive the region from the stack, use the asset hash as the key, copy the
   * file extension over, and set the prefix.
   */
  public defaultAddFileAsset(stack: Stack, asset: FileAssetSource, target: AssetManifestFileDestination, options?: AddFileAssetOptions) {
    validateFileAssetSource(asset);

    const extension =
      asset.fileName != undefined ? path.extname(asset.fileName) : '';
    const objectKey =
      (target.bucketPrefix ?? '') +
      asset.sourceHash +
      (asset.packaging === FileAssetPackaging.ZIP_DIRECTORY
        ? '.zip'
        : extension);

    // Add to manifest
    return this.addFileAsset(stack, asset.sourceHash, {
      path: asset.fileName,
      executable: asset.executable,
      packaging: asset.packaging,
    }, {
      bucketName: target.bucketName,
      objectKey,
      region: resolvedOr(stack.region, undefined),
      assumeRoleArn: target.role?.assumeRoleArn,
      assumeRoleExternalId: target.role?.assumeRoleExternalId,
      assumeRoleAdditionalOptions: target.role?.assumeRoleAdditionalOptions,
    }, options);
  }

  /**
   * Add a docker image asset to the manifest with default settings
   *
   * Derive the region from the stack, use the asset hash as the key, and set the prefix.
   */
  public defaultAddDockerImageAsset(
    stack: Stack,
    asset: DockerImageAssetSource,
    target: AssetManifestDockerImageDestination,
    options?: AddDockerImageAssetOptions,
  ) {
    validateDockerImageAssetSource(asset);
    const imageTag = `${target.dockerTagPrefix ?? ''}${asset.sourceHash}`;

    // Add to manifest
    const sourceHash = asset.assetName ? `${asset.assetName}-${asset.sourceHash}` : asset.sourceHash;
    return this.addDockerImageAsset(stack, sourceHash, {
      executable: asset.executable,
      directory: asset.directoryName,
      dockerBuildArgs: asset.dockerBuildArgs,
      dockerBuildSecrets: asset.dockerBuildSecrets,
      dockerBuildSsh: asset.dockerBuildSsh,
      dockerBuildTarget: asset.dockerBuildTarget,
      dockerFile: asset.dockerFile,
      networkMode: asset.networkMode,
      platform: asset.platform,
      dockerOutputs: asset.dockerOutputs,
      cacheFrom: asset.dockerCacheFrom,
      cacheTo: asset.dockerCacheTo,
      cacheDisabled: asset.dockerCacheDisabled,
    }, {
      repositoryName: target.repositoryName,
      imageTag,
      region: resolvedOr(stack.region, undefined),
      assumeRoleArn: target.role?.assumeRoleArn,
      assumeRoleExternalId: target.role?.assumeRoleExternalId,
      assumeRoleAdditionalOptions: target.role?.assumeRoleAdditionalOptions,
    }, options);
  }

  /**
   * Add a file asset source and destination to the manifest
   *
   * sourceHash should be unique for every source.
   */
  public addFileAsset(stack: Stack, sourceHash: string, source: cxschema.FileSource, dest: cxschema.FileDestination, options?: AddFileAssetOptions) {
    if (!this.files[sourceHash]) {
      this.files[sourceHash] = {
        displayName: options?.displayName,
        source,
        destinations: {},
      };
    }

    // Create destination key by appending hash of destination properties to manifestEnvName
    // This ensures assets with same content but different destinations are published separately
    const baseEnvName = this.manifestEnvName(stack);
    const destHash = contentHash(JSON.stringify(dest)).slice(0, 8);
    const destinationKey = `${baseEnvName}-${destHash}`;

    this.files[sourceHash].destinations[destinationKey] = dest;
    return dest;
  }

  /**
   * Add a docker asset source and destination to the manifest
   *
   * sourceHash should be unique for every source.
   */
  public addDockerImageAsset(
    stack: Stack,
    sourceHash: string,
    source: cxschema.DockerImageSource,
    dest: cxschema.DockerImageDestination,
    options?: AddDockerImageAssetOptions,
  ) {
    if (!this.dockerImages[sourceHash]) {
      this.dockerImages[sourceHash] = {
        displayName: options?.displayName,
        source,
        destinations: {},
      };
    }

    // Create destination key by appending hash of destination properties to manifestEnvName
    // This ensures assets with same content but different destinations are published separately
    const baseEnvName = this.manifestEnvName(stack);
    const destHash = contentHash(JSON.stringify(dest)).slice(0, 8);
    const destinationKey = `${baseEnvName}-${destHash}`;

    this.dockerImages[sourceHash].destinations[destinationKey] = dest;
    return dest;
  }

  /**
   * Whether there are any assets registered in the manifest
   */
  public get hasAssets() {
    return Object.keys(this.files).length + Object.keys(this.dockerImages).length > 0;
  }

  /**
   * Write the manifest to disk, and add it to the synthesis session
   *
   * Return the artifact id, which should be added to the `additionalDependencies`
   * field of the stack artifact.
   */
  public emitManifest(
    stack: Stack,
    session: ISynthesisSession,
    options: cxschema.AssetManifestOptions = {},
    dependencies: string[] = [],
  ): string {
    const artifactId = `${stack.artifactId}.assets`;
    const manifestFile = `${artifactId}.json`;
    const outPath = path.join(session.assembly.outdir, manifestFile);

    const manifest: cxschema.AssetManifest = {
      version: cxschema.Manifest.version(),
      files: this.files,
      dockerImages: this.dockerImages,
    };

    fs.writeFileSync(outPath, JSON.stringify(manifest, undefined, 2));

    session.assembly.addArtifact(artifactId, {
      type: cxschema.ArtifactType.ASSET_MANIFEST,
      properties: {
        file: manifestFile,
        ...options,
      },
      dependencies: dependencies.length > 0 ? dependencies : undefined,
    });

    return artifactId;
  }

  private manifestEnvName(stack: Stack): string {
    return [
      resolvedOr(stack.account, 'current_account'),
      resolvedOr(stack.region, 'current_region'),
    ].join('-');
  }
}

/**
 * Options for the addFileAsset operation
 */
export interface AddFileAssetOptions {
  /**
   * A display name to associate with the asset
   *
   * @default - No display name
   */
  readonly displayName?: string;
}

/**
 * Options for the addDockerImageAsset operation
 */
export interface AddDockerImageAssetOptions {
  /**
   * A display name to associate with the asset
   *
   * @default - No display name
   */
  readonly displayName?: string;
}

/**
 * The destination for a file asset, when it is given to the AssetManifestBuilder
 */
export interface AssetManifestFileDestination {
  /**
   * Bucket name where the file asset should be written
   */
  readonly bucketName: string;

  /**
   * Prefix to prepend to the asset hash
   *
   * @default ''
   */
  readonly bucketPrefix?: string;

  /**
   * Role to use for uploading
   *
   * @default - current role
   */
  readonly role?: RoleOptions;
}

/**
 * The destination for a docker image asset, when it is given to the AssetManifestBuilder
 */
export interface AssetManifestDockerImageDestination {
  /**
   * Repository name where the docker image asset should be written
   */
  readonly repositoryName: string;

  /**
   * Prefix to add to the asset hash to make the Docker image tag
   *
   * @default ''
   */
  readonly dockerTagPrefix?: string;

  /**
   * Role to use to perform the upload
   *
   * @default - No role
   */
  readonly role?: RoleOptions;
}

/**
 * Options for specifying a role
 */
export interface RoleOptions {
  /**
   * ARN of the role to assume
   */
  readonly assumeRoleArn: string;

  /**
   * External ID to use when assuming the role
   *
   * @default - No external ID
   */
  readonly assumeRoleExternalId?: string;

  /**
   * Additional options to pass to STS when assuming the role for cloudformation deployments.
   *
   * - `RoleArn` should not be used. Use the dedicated `assumeRoleArn` property instead.
   * - `ExternalId` should not be used. Use the dedicated `assumeRoleExternalId` instead.
   * - `TransitiveTagKeys` defaults to use all keys (if any) specified in `Tags`. E.g, all tags are transitive by default.
   *
   * @see https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/STS.html#assumeRole-property
   * @default - No additional options.
   */
  readonly assumeRoleAdditionalOptions?: { [key: string]: any };

}

function validateFileAssetSource(asset: FileAssetSource) {
  if (!!asset.executable === !!asset.fileName) {
    throw new UnscopedValidationError(`Exactly one of 'fileName' or 'executable' is required, got: ${JSON.stringify(asset)}`);
  }

  if (!!asset.packaging !== !!asset.fileName) {
    throw new UnscopedValidationError(`'packaging' is expected in combination with 'fileName', got: ${JSON.stringify(asset)}`);
  }

  if (Token.isUnresolved(asset.displayName)) {
    throw new UnscopedValidationError(`'displayName' may not contain a Token, got: ${JSON.stringify(asset.displayName)}`);
  }
}

function validateDockerImageAssetSource(asset: DockerImageAssetSource) {
  if (!!asset.executable === !!asset.directoryName) {
    throw new UnscopedValidationError(`Exactly one of 'directoryName' or 'executable' is required, got: ${JSON.stringify(asset)}`);
  }

  if (Token.isUnresolved(asset.displayName)) {
    throw new UnscopedValidationError(`'displayName' may not contain a Token, got: ${JSON.stringify(asset.displayName)}`);
  }

  check('dockerBuildArgs');
  check('dockerBuildTarget');
  check('dockerOutputs');
  check('dockerFile');

  function check<K extends keyof DockerImageAssetSource>(key: K) {
    if (asset[key] && !asset.directoryName) {
      throw new UnscopedValidationError(`'${key}' is only allowed in combination with 'directoryName', got: ${JSON.stringify(asset)}`);
    }
  }
}
