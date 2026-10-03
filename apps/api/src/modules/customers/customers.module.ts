import { Module } from '@nestjs/common';
import { CustomerNotesRepository } from './customer-notes.repository';
import { CustomersController } from './customers.controller';
import { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';

/**
 * The seller-facing Customers API: the list, a customer's detail, orders and
 * notes, and contact edits. Customers themselves are created by the Messenger
 * ingest (ConversationsModule), never here.
 */
@Module({
  controllers: [CustomersController],
  providers: [CustomersRepository, CustomerNotesRepository, CustomersService],
})
export class CustomersModule {}
