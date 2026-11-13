export default {
  async email(message, env, ctx) {
    const from = message.from;
    const to = message.to;
    const subject = message.headers.get('subject') || '(no subject)';

    console.log(`Email received from ${from} to ${to}: ${subject}`);

    const text = await message.text();
    console.log(text);

    return new Response(null, { status: 200 });
  },
};