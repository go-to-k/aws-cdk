#!/usr/bin/env node
import * as path from 'path';
import * as firehose from '@aws-cdk/aws-kinesisfirehose-alpha';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambdanodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cdk from 'aws-cdk-lib';
import * as destinations from '../lib';

const app = new cdk.App();

const stack = new cdk.Stack(app, 'aws-cdk-firehose-delivery-stream-s3-all-properties');

const bucket = new s3.Bucket(stack, 'Bucket', {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});

const backupBucket = new s3.Bucket(stack, 'BackupBucket', {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
});
const logGroup = new logs.LogGroup(stack, 'LogGroup', {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const dataProcessorFunction = new lambdanodejs.NodejsFunction(stack, 'DataProcessorFunction', {
  entry: path.join(__dirname, 'lambda-data-processor.js'),
  timeout: cdk.Duration.minutes(1),
});

const processor = new firehose.LambdaFunctionProcessor(dataProcessorFunction, {
  bufferInterval: cdk.Duration.seconds(60),
  bufferSize: cdk.Size.mebibytes(1),
  retries: 1,
});

const key = new kms.Key(stack, 'Key', {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

const backupKey = new kms.Key(stack, 'BackupKey', {
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

new firehose.DeliveryStream(stack, 'Delivery Stream', {
  destination: new destinations.S3Bucket(bucket, {
    loggingConfig: new destinations.EnableLogging(logGroup),
    processor: processor,
    compression: destinations.Compression.GZIP,
    dataOutputPrefix: 'regularPrefix',
    errorOutputPrefix: 'errorPrefix',
    bufferingInterval: cdk.Duration.seconds(60),
    bufferingSize: cdk.Size.mebibytes(1),
    encryptionKey: key,
    s3Backup: {
      mode: destinations.BackupMode.ALL,
      bucket: backupBucket,
      compression: destinations.Compression.ZIP,
      dataOutputPrefix: 'backupPrefix',
      errorOutputPrefix: 'backupErrorPrefix',
      bufferingInterval: cdk.Duration.seconds(60),
      bufferingSize: cdk.Size.mebibytes(1),
      encryptionKey: backupKey,
    },
  }),
});

new firehose.DeliveryStream(stack, 'ZeroBufferingDeliveryStream', {
  destination: new destinations.S3Bucket(bucket, {
    compression: destinations.Compression.GZIP,
    dataOutputPrefix: 'regularPrefix',
    errorOutputPrefix: 'errorPrefix',
    bufferingInterval: cdk.Duration.seconds(0),
  }),
});

app.synth();
