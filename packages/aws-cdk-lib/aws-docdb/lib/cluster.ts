import { Construct } from 'constructs';
import { DatabaseClusterAttributes, IDatabaseCluster } from './cluster-ref';
import { DatabaseSecret } from './database-secret';
import { CfnDBCluster, CfnDBInstance, CfnDBSubnetGroup } from './docdb.generated';
import { Endpoint } from './endpoint';
import { IClusterParameterGroup } from './parameter-group';
import { BackupProps, Login, RotationMultiUserOptions } from './props';
import * as ec2 from '../../aws-ec2';
import { IRole } from '../../aws-iam';
import * as kms from '../../aws-kms';
import * as logs from '../../aws-logs';
import { CaCertificate } from '../../aws-rds';
import * as secretsmanager from '../../aws-secretsmanager';
import { CfnResource, Duration, RemovalPolicy, Resource, Token, UnscopedValidationError, ValidationError } from '../../core';
import { addConstructMetadata, MethodMetadata } from '../../core/lib/metadata-resource';
import { propertyInjectable } from '../../core/lib/prop-injectable';

const MIN_ENGINE_VERSION_FOR_IO_OPTIMIZED_STORAGE = 5;

/**
 * The storage type of the DocDB cluster
 */
export enum StorageType {
  /**
   * Standard storage
   */
  STANDARD = 'standard',

  /**
   * I/O-optimized storage
   */
  IOPT1 = 'iopt1',
}

/**
 * Properties for a new database cluster
 */
export interface DatabaseClusterProps {
  /**
   * What version of the database to start
   *
   * @default -  the latest major version
   */
  readonly engineVersion?: string;

  /**
   * The port the DocumentDB cluster will listen on
   *
   * @default DatabaseCluster.DEFAULT_PORT
   */
  readonly port?: number;

  /**
   * Username and password for the administrative user
   */
  readonly masterUser: Login;

  /**
   * Backup settings
   *
   * @default - Backup retention period for automated backups is 1 day.
   * Backup preferred window is set to a 30-minute window selected at random from an
   * 8-hour block of time for each AWS Region, occurring on a random day of the week.
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/backup-restore.db-cluster-snapshots.html#backup-restore.backup-window
   */
  readonly backup?: BackupProps;

  /**
   * The KMS key for storage encryption.
   *
   * @default - default master key.
   */
  readonly kmsKey?: kms.IKey;

  /**
   * Whether to enable storage encryption
   *
   * @default true
   */
  readonly storageEncrypted?: boolean;

  /**
   * Number of DocDB compute instances
   *
   * @default 1
   */
  readonly instances?: number;

  /**
   * An optional identifier for the cluster
   *
   * @default - A name is automatically generated.
   */
  readonly dbClusterName?: string;

  /**
   * Base identifier for instances
   *
   * Every replica is named by appending the replica number to this string, 1-based.
   *
   * @default - `dbClusterName` is used with the word "Instance" appended. If `dbClusterName` is not provided, the
   * identifier is automatically generated.
   */
  readonly instanceIdentifierBase?: string;

  /**
   * What type of instance to start for the replicas
   */
  readonly instanceType: ec2.InstanceType;

  /**
   * The identifier of the CA certificate used for the instances.
   *
   * Specifying or updating this property triggers a reboot.
   *
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/ca_cert_rotation.html
   *
   * @default - DocumentDB will choose a certificate authority
   */
  readonly caCertificate?: CaCertificate;

  /**
   * What subnets to run the DocumentDB instances in.
   *
   * Must be at least 2 subnets in two different AZs.
   */
  readonly vpc: ec2.IVpc;

  /**
   * Where to place the instances within the VPC
   *
   * @default private subnets
   */
  readonly vpcSubnets?: ec2.SubnetSelection;

  /**
   * Security group.
   *
   * @default a new security group is created.
   */
  readonly securityGroup?: ec2.ISecurityGroup;

  /**
   * The DB parameter group to associate with the instance.
   *
   * @default no parameter group
   */
  readonly parameterGroup?: IClusterParameterGroup;

  /**
   * A weekly time range in which maintenance should preferably execute.
   *
   * Must be at least 30 minutes long.
   *
   * Example: 'tue:04:17-tue:04:47'
   *
   * @default - 30-minute window selected at random from an 8-hour block of time for
   * each AWS Region, occurring on a random day of the week.
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/db-instance-maintain.html#maintenance-window
   */
  readonly preferredMaintenanceWindow?: string;

  /**
   * The removal policy to apply when the cluster and its instances are removed
   * or replaced during a stack update, or when the stack is deleted. This
   * removal policy also applies to the implicit security group created for the
   * cluster if one is not supplied as a parameter.
   *
   * When set to `SNAPSHOT`, the removal policy for the instances and the security group
   * will default to `DESTROY` as those resources do not support the policy.
   *
   * Use the `instanceRemovalPolicy` and `securityGroupRemovalPolicy` to change the behavior.
   *
   * @default - Retain cluster.
   */
  readonly removalPolicy?: RemovalPolicy;

  /**
   * Specifies whether this cluster can be deleted. If deletionProtection is
   * enabled, the cluster cannot be deleted unless it is modified and
   * deletionProtection is disabled. deletionProtection protects clusters from
   * being accidentally deleted.
   *
   * @default - false
   */
  readonly deletionProtection?: boolean;

  /**
   * Whether the profiler logs should be exported to CloudWatch.
   * Note that you also have to configure the profiler log export in the Cluster's Parameter Group.
   *
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/profiling.html#profiling.enable-profiling
   * @default false
   */
  readonly exportProfilerLogsToCloudWatch?: boolean;

  /**
   * Whether the audit logs should be exported to CloudWatch.
   * Note that you also have to configure the audit log export in the Cluster's Parameter Group.
   *
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/event-auditing.html#event-auditing-enabling-auditing
   * @default false
   */
  readonly exportAuditLogsToCloudWatch?: boolean;

  /**
   * The number of days log events are kept in CloudWatch Logs. When updating
   * this property, unsetting it doesn't remove the log retention policy. To
   * remove the retention policy, set the value to `Infinity`.
   *
   * @default - logs never expire
   */
  readonly cloudWatchLogsRetention?: logs.RetentionDays;

  /**
   * The IAM role for the Lambda function associated with the custom resource
   * that sets the retention policy.
   *
   * @default - a new role is created.
   */
  readonly cloudWatchLogsRetentionRole?: IRole;

  /**
   * A value that indicates whether to enable Performance Insights for the instances in the DB Cluster.
   *
   * @default - false
   */
  readonly enablePerformanceInsights?: boolean;

  /**
   * The removal policy to apply to the cluster's instances.
   *
   * Cannot be set to `SNAPSHOT`.
   *
   * @default - `RemovalPolicy.DESTROY` when `removalPolicy` is set to `SNAPSHOT`, `removalPolicy` otherwise.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-attribute-deletionpolicy.html
   */
  readonly instanceRemovalPolicy?: RemovalPolicy;

  /**
   * The removal policy to apply to the cluster's security group.
   *
   * Cannot be set to `SNAPSHOT`.
   *
   * @default - `RemovalPolicy.DESTROY` when `removalPolicy` is set to `SNAPSHOT`, `removalPolicy` otherwise.
   *
   * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-attribute-deletionpolicy.html
   */
  readonly securityGroupRemovalPolicy?: RemovalPolicy;

  /**
   * Whether to copy tags to the snapshot when a snapshot is created.
   *
   * @default - false
   */
  readonly copyTagsToSnapshot?: boolean;

  /**
   * The storage type of the DocDB cluster.
   *
   * I/O-optimized storage is supported starting with engine version 5.0.0.
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/db-cluster-storage-configs.html
   * @see https://docs.aws.amazon.com/documentdb/latest/developerguide/release-notes.html#release-notes.11-21-2023
   *
   * @default StorageType.STANDARD
   */
  readonly storageType?: StorageType;
}

/**
 * A new or imported clustered database.
 */
abstract class DatabaseClusterBase extends Resource implements IDatabaseCluster {
  /**
   * Identifier of the cluster
   */
  public abstract readonly clusterIdentifier: string;
  /**
   * Identifiers of the replicas
   */
  public abstract readonly instanceIdentifiers: string[];

  /**
   * The endpoint to use for read/write operations
   */
  public abstract readonly clusterEndpoint: Endpoint;

  /**
   * Endpoint to use for load-balanced read-only operations.
   */
  public abstract readonly clusterReadEndpoint: Endpoint;

  /**
   * Endpoints which address each individual replica.
   */
  public abstract readonly instanceEndpoints: Endpoint[];

  /**
   * Access to the network connections
   */
  public abstract readonly connections: ec2.Connections;

  /**
   * Security group identifier of this database
   */
  public abstract readonly securityGroupId: string;

  /**
   * Renders the secret attachment target specifications.
   */
  public asSecretAttachmentTarget(): secretsmanager.SecretAttachmentTargetProps {
    return {
      targetId: this.clusterIdentifier,
      targetType: secretsmanager.AttachmentTargetType.DOCDB_DB_CLUSTER,
    };
  }
}

/**
 * Create a clustered database with a given number of instances.
 *
 * @resource AWS::DocDB::DBCluster
 */
@propertyInjectable
export class DatabaseCluster extends DatabaseClusterBase {
  /**
   * Uniquely identifies this class.
   */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-docdb.DatabaseCluster';

  /**
   * The default number of instances in the DocDB cluster if none are
   * specified
   */
  public static readonly DEFAULT_NUM_INSTANCES = 1;

  /**
   * The default port Document DB listens on
   */
  public static readonly DEFAULT_PORT = 27017;

  /**
   * Import an existing DatabaseCluster from properties
   */
  public static fromDatabaseClusterAttributes(scope: Construct, id: string, attrs: DatabaseClusterAttributes): IDatabaseCluster {
    class Import extends DatabaseClusterBase implements IDatabaseCluster {
      public readonly defaultPort = typeof attrs.port !== 'undefined' ? ec2.Port.tcp(attrs.port) : undefined;
      public readonly connections = new ec2.Connections({
        securityGroups: attrs.securityGroup ? [attrs.securityGroup] : undefined,
        defaultPort: this.defaultPort,
      });
      public readonly clusterIdentifier = attrs.clusterIdentifier;
      private readonly _instanceIdentifiers = attrs.instanceIdentifiers;
      private readonly _clusterEndpoint = attrs.clusterEndpointAddress && typeof attrs.port !== 'undefined' ?
        new Endpoint(attrs.clusterEndpointAddress, attrs.port) : undefined;
      private readonly _clusterReadEndpoint = attrs.readerEndpointAddress && typeof attrs.port !== 'undefined' ?
        new Endpoint(attrs.readerEndpointAddress, attrs.port) : undefined;
      private readonly _instanceEndpoints = attrs.instanceEndpointAddresses && typeof attrs.port !== 'undefined' ?
        attrs.instanceEndpointAddresses.map(addr => new Endpoint(addr, attrs.port!)) : undefined;
      private readonly _securityGroupId = attrs.securityGroup?.securityGroupId;

      public get instanceIdentifiers(): string[] {
        if (!this._instanceIdentifiers) {
          throw new UnscopedValidationError('Cannot access `instanceIdentifiers` of an imported cluster without provided instanceIdentifiers');
        }
        return this._instanceIdentifiers;
      }

      public get clusterEndpoint(): Endpoint {
        if (!this._clusterEndpoint) {
          throw new UnscopedValidationError('Cannot access `clusterEndpoint` of an imported cluster without an endpoint address and port');
        }
        return this._clusterEndpoint;
      }

      public get clusterReadEndpoint(): Endpoint {
        if (!this._clusterReadEndpoint) {
          throw new UnscopedValidationError('Cannot access `clusterReadEndpoint` of an imported cluster without a readerEndpointAddress and port');
        }
        return this._clusterReadEndpoint;
      }

      public get instanceEndpoints(): Endpoint[] {
        if (!this._instanceEndpoints) {
          throw new UnscopedValidationError('Cannot access `instanceEndpoints` of an imported cluster without instanceEndpointAddresses and port');
        }
        return this._instanceEndpoints;
      }

      public get securityGroupId(): string {
        if (!this._securityGroupId) {
          throw new UnscopedValidationError('Cannot access `securityGroupId` of an imported cluster without securityGroupId');
        }
        return this._securityGroupId;
      }
    }

    return new Import(scope, id);
  }

  /**
   * The single user secret rotation application.
   */
  private static readonly SINGLE_USER_ROTATION_APPLICATION = secretsmanager.SecretRotationApplication.MONGODB_ROTATION_SINGLE_USER;

  /**
   * The multi user secret rotation application.
   */
  private static readonly MULTI_USER_ROTATION_APPLICATION = secretsmanager.SecretRotationApplication.MONGODB_ROTATION_MULTI_USER;

  /**
   * Identifier of the cluster
   */
  public readonly clusterIdentifier: string;

  /**
   * The endpoint to use for read/write operations
   */
  public readonly clusterEndpoint: Endpoint;

  /**
   * Endpoint to use for load-balanced read-only operations.
   */
  public readonly clusterReadEndpoint: Endpoint;

  /**
   * The resource id for the cluster; for example: cluster-ABCD1234EFGH5678IJKL90MNOP. The cluster ID uniquely
   * identifies the cluster and is used in things like IAM authentication policies.
   * @attribute ClusterResourceId
   */
  public readonly clusterResourceIdentifier: string;

  /**
   * The connections object to implement IConnectable
   */
  public readonly connections: ec2.Connections;

  /**
   * Identifiers of the replicas
   */
  public readonly instanceIdentifiers: string[] = [];

  /**
   * Endpoints which address each individual replica.
   */
  public readonly instanceEndpoints: Endpoint[] = [];

  /**
   * Security group identifier of this database
   */
  public readonly securityGroupId: string;

  /**
   * The secret attached to this cluster
   */
  public readonly secret?: secretsmanager.ISecret;

  /**
   * The underlying CloudFormation resource for a database cluster.
   */
  private readonly cluster: CfnDBCluster;

  /**
   * The VPC where the DB subnet group is created.
   */
  private readonly vpc: ec2.IVpc;

  /**
   * The subnets used by the DB subnet group.
   */
  private readonly vpcSubnets?: ec2.SubnetSelection;

  constructor(scope: Construct, id: string, props: DatabaseClusterProps) {
    super(scope, id);
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    this.vpc = props.vpc;
    this.vpcSubnets = props.vpcSubnets;

    // Determine the subnet(s) to deploy the DocDB cluster to
    const { subnetIds, internetConnectivityEstablished } = this.vpc.selectSubnets(this.vpcSubnets);

    // DocDB clusters require a subnet group with subnets from at least two AZs.
    // We cannot test whether the subnets are in different AZs, but at least we can test the amount.
    // See https://docs.aws.amazon.com/documentdb/latest/developerguide/replication.html#replication.high-availability
    if (subnetIds.length < 2) {
      throw new ValidationError(`Cluster requires at least 2 subnets, got ${subnetIds.length}`, this);
    }

    const subnetGroup = new CfnDBSubnetGroup(this, 'Subnets', {
      dbSubnetGroupDescription: `Subnets for ${id} database`,
      subnetIds,
    });

    // Create the security group for the DB cluster
    let securityGroup: ec2.ISecurityGroup;
    if (props.securityGroup) {
      securityGroup = props.securityGroup;
    } else {
      securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
        description: 'DocumentDB security group',
        vpc: this.vpc,
      });
      // HACK: Use an escape-hatch to apply a consistent removal policy to the
      // security group so we don't get ValidationErrors when trying to delete the stack.
      const securityGroupRemovalPolicy = this.getSecurityGroupRemovalPolicy(props);
      (securityGroup.node.defaultChild as CfnResource).applyRemovalPolicy(securityGroupRemovalPolicy, {
        applyToUpdateReplacePolicy: true,
      });
    }
    this.securityGroupId = securityGroup.securityGroupId;

    // Create the CloudwatchLogsConfiguration
    const enableCloudwatchLogsExports: string[] = [];
    if (props.exportAuditLogsToCloudWatch) {
      enableCloudwatchLogsExports.push('audit');
    }
    if (props.exportProfilerLogsToCloudWatch) {
      enableCloudwatchLogsExports.push('profiler');
    }

    // Create the secret manager secret if no password is specified
    let secret: DatabaseSecret | undefined;
    if (!props.masterUser.password) {
      secret = new DatabaseSecret(this, 'Secret', {
        username: props.masterUser.username,
        encryptionKey: props.masterUser.kmsKey,
        excludeCharacters: props.masterUser.excludeCharacters,
        secretName: props.masterUser.secretName,
      });
    }

    // Default to encrypted storage
    const storageEncrypted = props.storageEncrypted ?? true;

    if (props.kmsKey && !storageEncrypted) {
      throw new ValidationError('KMS key supplied but storageEncrypted is false', this);
    }

    const validEngineVersionRegex = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
    if (props.engineVersion !== undefined && !validEngineVersionRegex.test(props.engineVersion)) {
      throw new ValidationError(`Invalid engine version: '${props.engineVersion}'. Engine version must be in the format x.y.z`, this);
    }

    if (
      props.storageType === StorageType.IOPT1
      && props.engineVersion !== undefined
      && Number(props.engineVersion.split('.')[0]) < MIN_ENGINE_VERSION_FOR_IO_OPTIMIZED_STORAGE
    ) {
      throw new ValidationError(`I/O-optimized storage is supported starting with engine version 5.0.0, got '${props.engineVersion}'`, this);
    }

    // Create the DocDB cluster
    this.cluster = new CfnDBCluster(this, 'Resource', {
      // Basic
      engineVersion: props.engineVersion,
      dbClusterIdentifier: props.dbClusterName,
      dbSubnetGroupName: subnetGroup.ref,
      port: props.port,
      vpcSecurityGroupIds: [this.securityGroupId],
      dbClusterParameterGroupName: props.parameterGroup?.parameterGroupName,
      deletionProtection: props.deletionProtection,
      // Admin
      masterUsername: secret ? secret.secretValueFromJson('username').unsafeUnwrap() : props.masterUser.username,
      masterUserPassword: secret
        ? secret.secretValueFromJson('password').unsafeUnwrap()
        : props.masterUser.password!.unsafeUnwrap(), // Safe usage
      // Backup
      backupRetentionPeriod: props.backup?.retention?.toDays(),
      preferredBackupWindow: props.backup?.preferredWindow,
      preferredMaintenanceWindow: props.preferredMaintenanceWindow,
      // EnableCloudwatchLogsExports
      enableCloudwatchLogsExports: enableCloudwatchLogsExports.length > 0 ? enableCloudwatchLogsExports : undefined,
      // Encryption
      kmsKeyId: props.kmsKey?.keyArn,
      storageEncrypted,
      // Tags
      copyTagsToSnapshot: props.copyTagsToSnapshot,
      storageType: props.storageType,
    });

    this.cluster.applyRemovalPolicy(props.removalPolicy, {
      applyToUpdateReplacePolicy: true,
    });

    this.clusterIdentifier = this.cluster.ref;
    this.clusterResourceIdentifier = this.cluster.attrClusterResourceId;

    const port = Token.asNumber(this.cluster.attrPort);
    this.clusterEndpoint = new Endpoint(this.cluster.attrEndpoint, port);
    this.clusterReadEndpoint = new Endpoint(this.cluster.attrReadEndpoint, port);

    this.setLogRetention(this, props, enableCloudwatchLogsExports);

    if (secret) {
      this.secret = secret.attach(this);
    }

    // Create the instances
    const instanceCount = props.instances ?? DatabaseCluster.DEFAULT_NUM_INSTANCES;
    if (instanceCount < 1) {
      throw new ValidationError('At least one instance is required', this);
    }

    const instanceRemovalPolicy = this.getInstanceRemovalPolicy(props);
    const caCertificateIdentifier = props.caCertificate ? props.caCertificate.toString() : undefined;

    for (let i = 0; i < instanceCount; i++) {
      const instanceIndex = i + 1;

      const instanceIdentifier = props.instanceIdentifierBase != null ? `${props.instanceIdentifierBase}${instanceIndex}`
        : props.dbClusterName != null ? `${props.dbClusterName}instance${instanceIndex}` : undefined;

      const instance = new CfnDBInstance(this, `Instance${instanceIndex}`, {
        // Link to cluster
        dbClusterIdentifier: this.cluster.ref,
        dbInstanceIdentifier: instanceIdentifier,
        // Instance properties
        dbInstanceClass: databaseInstanceType(props.instanceType),
        enablePerformanceInsights: props.enablePerformanceInsights,
        caCertificateIdentifier: caCertificateIdentifier,
      });

      instance.applyRemovalPolicy(instanceRemovalPolicy, {
        applyToUpdateReplacePolicy: true,
      });

      // We must have a dependency on the NAT gateway provider here to create
      // things in the right order.
      instance.node.addDependency(internetConnectivityEstablished);

      this.instanceIdentifiers.push(instance.ref);
      this.instanceEndpoints.push(new Endpoint(instance.attrEndpoint, port));
    }

    this.connections = new ec2.Connections({
      defaultPort: ec2.Port.tcp(port),
      securityGroups: [securityGroup],
    });
  }

  /**
   * Sets up CloudWatch log retention if configured.
   */
  private setLogRetention(cluster: DatabaseCluster, props: DatabaseClusterProps, cloudwatchLogsExports: string[]) {
    if (props.cloudWatchLogsRetention) {
      for (const log of cloudwatchLogsExports) {
        new logs.LogRetention(cluster, `LogRetention${log}`, {
          logGroupName: `/aws/docdb/${cluster.clusterIdentifier}/${log}`,
          retention: props.cloudWatchLogsRetention,
          role: props.cloudWatchLogsRetentionRole,
        });
      }
    }
  }

  private getInstanceRemovalPolicy(props: DatabaseClusterProps) {
    if (props.instanceRemovalPolicy === RemovalPolicy.SNAPSHOT) {
      throw new ValidationError('AWS::DocDB::DBInstance does not support the SNAPSHOT removal policy', this);
    }
    if (props.instanceRemovalPolicy) return props.instanceRemovalPolicy;
    return !props.removalPolicy || props.removalPolicy !== RemovalPolicy.SNAPSHOT ?
      props.removalPolicy : RemovalPolicy.DESTROY;
  }

  private getSecurityGroupRemovalPolicy(props: DatabaseClusterProps) {
    if (props.securityGroupRemovalPolicy === RemovalPolicy.SNAPSHOT) {
      throw new ValidationError('AWS::EC2::SecurityGroup does not support the SNAPSHOT removal policy', this);
    }
    if (props.securityGroupRemovalPolicy) return props.securityGroupRemovalPolicy;
    return !props.removalPolicy || props.removalPolicy !== RemovalPolicy.SNAPSHOT ?
      props.removalPolicy : RemovalPolicy.DESTROY;
  }

  /**
   * Adds the single user rotation of the master password to this cluster.
   *
   * @param [automaticallyAfter=Duration.days(30)] Specifies the number of days after the previous rotation
   * before Secrets Manager triggers the next automatic rotation.
   */
  @MethodMetadata()
  public addRotationSingleUser(automaticallyAfter?: Duration): secretsmanager.SecretRotation {
    if (!this.secret) {
      throw new ValidationError('Cannot add single user rotation for a cluster without secret.', this);
    }

    const id = 'RotationSingleUser';
    const existing = this.node.tryFindChild(id);
    if (existing) {
      throw new ValidationError('A single user rotation was already added to this cluster.', this);
    }

    return new secretsmanager.SecretRotation(this, id, {
      secret: this.secret,
      automaticallyAfter,
      application: DatabaseCluster.SINGLE_USER_ROTATION_APPLICATION,
      excludeCharacters: (this.node.tryFindChild('Secret') as DatabaseSecret)._excludedCharacters,
      vpc: this.vpc,
      vpcSubnets: this.vpcSubnets,
      target: this,
    });
  }

  /**
   * Adds the multi user rotation to this cluster.
   */
  @MethodMetadata()
  public addRotationMultiUser(id: string, options: RotationMultiUserOptions): secretsmanager.SecretRotation {
    if (!this.secret) {
      throw new ValidationError('Cannot add multi user rotation for a cluster without secret.', this);
    }
    return new secretsmanager.SecretRotation(this, id, {
      secret: options.secret,
      masterSecret: this.secret,
      automaticallyAfter: options.automaticallyAfter,
      excludeCharacters: (this.node.tryFindChild('Secret') as DatabaseSecret)._excludedCharacters,
      application: DatabaseCluster.MULTI_USER_ROTATION_APPLICATION,
      vpc: this.vpc,
      vpcSubnets: this.vpcSubnets,
      target: this,
    });
  }

  /**
   * Adds security groups to this cluster.
   * @param securityGroups The security groups to add.
   */
  @MethodMetadata()
  public addSecurityGroups(...securityGroups: ec2.ISecurityGroup[]): void {
    if (this.cluster.vpcSecurityGroupIds === undefined) {
      this.cluster.vpcSecurityGroupIds = [];
    }
    this.cluster.vpcSecurityGroupIds.push(...securityGroups.map(sg => sg.securityGroupId));
  }
}

/**
 * Turn a regular instance type into a database instance type
 */
function databaseInstanceType(instanceType: ec2.InstanceType) {
  return 'db.' + instanceType.toString();
}
