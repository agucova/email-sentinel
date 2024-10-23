import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

// Configuration
const TARGET_EMAIL = "sentinel@agucova.dev";
const WORKER_ROUTE = "email-sentinel.agucova.workers.dev";

interface ChallengeState {
  challengeToken: string;
  originalEmail: {
    from: string;
    to: string;
    rawEmail: Uint8Array;
    timestamp: number;
    headers: Headers;
  };
}

export interface Env {
  CHALLENGE_STORE: KVNamespace;
  WHITELIST_STORE: KVNamespace;
  MAILER: SendEmail;
}

function generateChallenge(): { question: string; answer: string } {
  const operations = [
    { op: '+', name: 'plus' },
    { op: '-', name: 'minus' },
    { op: '×', name: 'times' }
  ];

  const operation = operations[Math.floor(Math.random() * operations.length)];
  const num1 = Math.floor(Math.random() * 10) + 1;
  const num2 = operation.op === '-' ?
    Math.floor(Math.random() * num1) + 1 :
    Math.floor(Math.random() * 10) + 1;

  let answer: number;
  switch(operation.op) {
    case '+': answer = num1 + num2; break;
    case '-': answer = num1 - num2; break;
    case '×': answer = num1 * num2; break;
    default: answer = num1 + num2;
  }

  console.log({
    event: "challenge_generated",
    operation: operation.name,
    num1,
    num2,
    answer
  });

  return {
    question: `What is ${num1} ${operation.op} ${num2}?`,
    answer: answer.toString(),
  };
}

function generateToken(): string {
  return crypto.randomUUID();
}

async function sendChallengeEmail(
  message: ForwardableEmailMessage,
  challenge: { question: string; answer: string },
  token: string,
  env: Env
): Promise<void> {
  const senderName = message.from.split('@')[0];
  const verificationLink = `https://${WORKER_ROUTE}/verify?token=${token}&answer=`;

  const msg = createMimeMessage();
  msg.setHeader("In-Reply-To", message.headers.get("Message-ID") || '');
  msg.setSender({ name: "Email Protection System", addr: message.to });
  msg.setRecipient(message.from);
  msg.setSubject("Please Verify Your Email ✉️");

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Verification Required</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; border-radius: 5px; padding: 20px; margin-bottom: 20px;">
    <h1 style="color: #2c3e50; margin-top: 0;">Quick Verification Needed</h1>
    <p>Hi${senderName ? ` ${senderName}` : ''},</p>
    <p>I've received your email and want to make sure it reaches me safely. To prevent spam, I use a simple one-time verification system for new senders.</p>

    <div style="background-color: white; border-left: 4px solid #3498db; padding: 15px; margin: 20px 0;">
      <p style="font-weight: bold; margin-bottom: 10px;">Your Challenge Question:</p>
      <p style="font-size: 18px; color: #2c3e50;">${challenge.question}</p>
    </div>

    <p>Click the correct answer below:</p>
    <div style="display: flex; flex-direction: column; gap: 10px;">
      ${Array.from({ length: 5 }, (_, i) => {
        const answerOption = parseInt(challenge.answer) + i - 2;
        return `<a href="${verificationLink}${answerOption}"
          style="background-color: #3498db; color: white; padding: 10px 15px;
          text-decoration: none; border-radius: 5px; text-align: center;">
          ${answerOption}
        </a>`;
      }).join('\n')}
    </div>

    <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
      <p style="color: #666; font-size: 14px;">
        ℹ️ This is a one-time verification. Once completed, your future emails will be delivered automatically.
      </p>
      <p style="color: #666; font-size: 14px;">
        ⏰ This verification link expires in 24 hours.
      </p>
    </div>
  </div>
</body>
</html>`;

  const plainText = `
Hi${senderName ? ` ${senderName}` : ''},

I've received your email and want to make sure it reaches me safely. To prevent spam, I use a simple one-time verification system for new senders.

Your Challenge Question:
${challenge.question}

To verify, click one of these links:
${Array.from({ length: 5 }, (_, i) =>
  `• ${parseInt(challenge.answer) + i - 2}: ${verificationLink}${parseInt(challenge.answer) + i - 2}`
).join('\n')}

Note:
• This is a one-time verification. Once completed, your future emails will be delivered automatically.
• This verification link expires in 24 hours.

Thank you for your understanding.
`.trim();

  msg.addMessage({
    contentType: 'text/plain',
    data: plainText
  });

  msg.addMessage({
    contentType: 'text/html',
    data: htmlContent
  });

  const replyMessage = new EmailMessage(
    message.to,
    message.from,
    msg.asRaw()
  );

  await message.reply(replyMessage);

  console.log({
    event: "challenge_email_sent",
    sender: message.from,
    token,
    question: challenge.question,
    messageId: message.headers.get("Message-ID")
  });
}

async function sendVerificationSuccessEmail(
  originalEmail: ChallengeState['originalEmail'],
  env: Env
): Promise<void> {
  const senderName = originalEmail.from.split('@')[0];

  const msg = createMimeMessage();
  msg.setSender({ name: "Email Protection System", addr: TARGET_EMAIL });
  msg.setRecipient(originalEmail.from);
  msg.setSubject("✅ Verification Successful - Email Delivered");

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Successful</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; border-radius: 5px; padding: 20px;">
    <h1 style="color: #2c3e50; margin-top: 0;">✅ Verification Successful</h1>
    <p>Hi${senderName ? ` ${senderName}` : ''},</p>

    <div style="background-color: white; border-left: 4px solid #27ae60; padding: 15px; margin: 20px 0;">
      <p>Your email has been successfully verified and delivered!</p>
      <p>You won't need to verify again - all future emails will be delivered automatically.</p>
    </div>

    <p>Thank you for your patience with this security measure.</p>
  </div>
</body>
</html>`;

  const plainText = `
Hi${senderName ? ` ${senderName}` : ''},

✅ Your email has been successfully verified and delivered!

You won't need to verify again - all future emails will be delivered automatically.

Thank you for your patience with this security measure.
`.trim();

  msg.addMessage({
    contentType: 'text/plain',
    data: plainText
  });

  msg.addMessage({
    contentType: 'text/html',
    data: htmlContent
  });

  const successMessage = new EmailMessage(
    TARGET_EMAIL,
    originalEmail.from,
    msg.asRaw()
  );

  await env.MAILER.send(successMessage);


  console.log({
    event: "success_email_sent",
    sender: originalEmail.from,
    messageId: originalEmail.headers.get("Message-ID")
  });
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {

    // Check if sender is whitelisted
    const isWhitelisted = await env.WHITELIST_STORE.get(message.from);
    if (isWhitelisted) {
      console.log({
        event: "whitelisted_email_forwarded",
        sender: message.from,
        messageId: message.headers.get("Message-ID")
      });
      await message.forward(TARGET_EMAIL);
      return;
    }

    // Generate challenge
    const challenge = generateChallenge();
    const token = generateToken();

    // Store challenge state
    const challengeState: ChallengeState = {
      challengeToken: token,
      originalEmail: {
        from: message.from,
        to: message.to,
        rawEmail: new Uint8Array(await new Response(message.raw).arrayBuffer()),
        timestamp: Date.now(),
        headers: message.headers,
      },
    };

    console.log({
      event: "challenge_stored",
      sender: message.from,
      token,
      timestamp: challengeState.originalEmail.timestamp,
      messageId: message.headers.get("Message-ID")
    });

    // Store in KV with 24-hour expiration
    await env.CHALLENGE_STORE.put(
      `challenge:${token}`,
      JSON.stringify({ ...challengeState, answer: challenge.answer }),
      { expirationTtl: 86400 }
    );

    // Send challenge email
    await sendChallengeEmail(message, challenge, token, env);

	console.log({
		event: "email_received",
		sender: message.from,
		recipient: message.to,
		subject: message.headers.get("Subject"),
		messageId: message.headers.get("Message-ID")
	  });
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/verify") {
      const token = url.searchParams.get("token");
      const answer = url.searchParams.get("answer");

      console.log({
        event: "verification_attempt",
        token,
        answer,
        ip: request.headers.get("CF-Connecting-IP")
      });

      if (!token || !answer) {
        console.log({
          event: "verification_error",
          error: "invalid_parameters",
          token,
          answer
        });
        return new Response("Invalid verification link", { status: 400 });
      }

      // Retrieve challenge state
      const challengeStateStr = await env.CHALLENGE_STORE.get(`challenge:${token}`);
      if (!challengeStateStr) {
        console.log({
          event: "verification_error",
          error: "challenge_not_found",
          token
        });
        return new Response("Challenge expired or invalid", { status: 400 });
      }

      const challengeState = JSON.parse(challengeStateStr);

      // Verify answer
      if (answer === challengeState.answer) {
        console.log({
          event: "verification_success",
          token,
          sender: challengeState.originalEmail.from,
          messageId: challengeState.originalEmail.headers.get("Message-ID"),
          timeTaken: Date.now() - challengeState.originalEmail.timestamp
        });

        // Add sender to whitelist
        await env.WHITELIST_STORE.put(challengeState.originalEmail.from, "true");

        // Forward the original email
        const msg = createMimeMessage();
        msg.setSender({ name: "Original Sender", addr: challengeState.originalEmail.from });
        msg.setRecipient(TARGET_EMAIL);
        const originalSubject = challengeState.originalEmail.headers.get("Subject") || "No Subject";
        msg.setSubject(`[Sentinel verified] ${originalSubject}`);
        msg.addMessage({
          contentType: 'application/octet-stream',
          data: challengeState.originalEmail.rawEmail,
        });

        const originalMessage = new EmailMessage(
          challengeState.originalEmail.from,
          TARGET_EMAIL,
          msg.asRaw()
        );

        await env.MAILER.send(originalMessage);

        // Send success confirmation email
        await sendVerificationSuccessEmail(challengeState.originalEmail, env);

        // Clean up challenge state
        await env.CHALLENGE_STORE.delete(`challenge:${token}`);

        return new Response(
          `<!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Verification Successful</title>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 40px auto; padding: 20px; }
                .success-card { background-color: #f8f9fa; border-radius: 5px; padding: 20px; text-align: center; }
                .success-icon { font-size: 48px; margin-bottom: 20px; }
                h1 { color: #2c3e50; }
              </style>
            </head>
            <body>
              <div class="success-card">
                <div class="success-icon">✅</div>
                <h1>Verification Successful!</h1>
                <p>Your email has been verified and delivered successfully.</p>
                <p>You won't need to verify again - all future emails will be delivered automatically.</p>
                <p>You can close this window now.</p>
              </div>
            </body>
          </html>`,
          {
            status: 200,
            headers: {
              "Content-Type": "text/html",
            },
          }
        );
      }

      console.log({
        event: "verification_error",
        error: "incorrect_answer",
        token,
        expectedAnswer: challengeState.answer,
        providedAnswer: answer
      });

      return new Response(
        `<!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Incorrect Answer</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 40px auto; padding: 20px; }
              .error-card { background-color: #fff3f3; border-radius: 5px; padding: 20px; text-align: center; }
              .error-icon { font-size: 48px; margin-bottom: 20px; }
              h1 { color: #e74c3c; }
            </style>
          </head>
          <body>
            <div class="error-card">
              <div class="error-icon">❌</div>
              <h1>Incorrect Answer</h1>
              <p>Please try again by selecting a different answer from your verification email.</p>
            </div>
          </body>
        </html>`,
        {
          status: 400,
          headers: {
            "Content-Type": "text/html",
          },
        }
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
