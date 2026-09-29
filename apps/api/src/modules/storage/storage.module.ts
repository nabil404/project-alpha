import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app.config';
import { ObjectStorage } from './object-storage';
import { S3ObjectStorage } from './s3-object-storage';

@Module({
  providers: [
    {
      provide: ObjectStorage,
      inject: [AppConfig],
      useFactory: (config: AppConfig): ObjectStorage =>
        new S3ObjectStorage(
          new S3Client({
            region: config.get('STORAGE_REGION'),
            endpoint: config.get('STORAGE_ENDPOINT'),
            credentials: {
              accessKeyId: config.get('STORAGE_ACCESS_KEY_ID'),
              secretAccessKey: config.get('STORAGE_SECRET_ACCESS_KEY'),
            },
            // Checksums only where the S3 API requires them: S3-compatible stores
            // such as R2 have lagged the SDK's newer default checksum headers.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
            // Bounded failure instead of a hung request; the SDK's default
            // retries still apply on top of these.
            requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
          }),
          config.get('STORAGE_BUCKET'),
          config.get('STORAGE_PUBLIC_BASE_URL'),
        ),
    },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
