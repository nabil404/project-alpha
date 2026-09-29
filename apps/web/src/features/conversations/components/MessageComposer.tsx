import type { KeyboardEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';
import { MESSAGE_TEXT_MAX_LENGTH, sendMessageSchema, type SendMessage } from '@app/shared';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useZodResolver } from '@/lib/form';

import { useSendMessage } from '../queries';

/**
 * The seller's reply box. Enter sends, Shift+Enter starts a new line. Sending
 * is eager: the reply moves into the thread and the box clears at once, so the
 * next one can be typed while it goes out; a failure shows under that reply,
 * not here. Closed outside Messenger's 24-hour window, which the API enforces
 * anyway.
 */
export function MessageComposer({
  conversationId,
  customerName,
  assistantActive,
  windowOpen,
}: {
  conversationId: string;
  customerName: string;
  assistantActive: boolean;
  windowOpen: boolean;
}) {
  const { t } = useTranslation('conversations');
  const send = useSendMessage(conversationId);

  const form = useForm<SendMessage>({
    resolver: useZodResolver(sendMessageSchema),
    defaultValues: { text: '' },
  });

  const onSubmit = (values: SendMessage) => {
    send.mutate(values);
    form.reset();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void form.handleSubmit(onSubmit)();
    }
  };

  if (!windowOpen) {
    return (
      <p className="border-t border-border bg-surface px-4 py-4 text-small text-ink-muted lg:border-0 lg:bg-transparent lg:px-6 lg:pb-6">
        {t('composer.windowClosed')}
      </p>
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col gap-2 border-t border-border bg-surface px-3 pt-2 pb-4 lg:border-0 lg:bg-transparent lg:px-6 lg:pt-4 lg:pb-6"
      >
        <p className="hidden text-small text-ink-muted lg:block">
          {assistantActive ? t('composer.hintAssistant') : t('composer.hintSeller')}
        </p>
        <FormField
          control={form.control}
          name="text"
          render={({ field }) => (
            <FormItem className="gap-1">
              <FormLabel className="sr-only">{t('composer.label')}</FormLabel>
              <div className="flex items-end gap-2 rounded-lg border border-border-strong bg-surface p-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring">
                <FormControl>
                  <textarea
                    rows={1}
                    maxLength={MESSAGE_TEXT_MAX_LENGTH}
                    placeholder={t('composer.placeholder', { name: customerName })}
                    onKeyDown={onKeyDown}
                    className="max-h-40 min-h-10 min-w-0 grow resize-none bg-transparent px-2 py-2 text-body text-ink [field-sizing:content] placeholder:text-ink-muted focus-visible:outline-none"
                    {...field}
                  />
                </FormControl>
                <Button
                  type="submit"
                  variant="primary"
                  className="max-lg:size-10 max-lg:rounded-full max-lg:px-0"
                >
                  <Send aria-hidden strokeWidth={1.5} />
                  <span className="max-lg:sr-only">{t('composer.send')}</span>
                </Button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
