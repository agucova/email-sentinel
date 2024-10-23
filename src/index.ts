import { EmailMessage } from 'cloudflare:email';
import { createMimeMessage } from 'mimetext';
import { ParsedMessage, parseMail } from '@protontech/jsmimeparser';
import { craftForwardedEmail } from './forward';

// Configuration
const SENTINEL_EMAIL = 'sentinel@agus.sh';
const TARGET_EMAIL = 'sentinel@agucova.dev';
const WORKER_ROUTE = 'email-sentinel.agucova.workers.dev';

interface ChallengeState {
	challengeToken: string;
	rawEmail: number[]; // We serialize as an array of the uint8 values
	timestamp: number;
	answer: string;
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
		{ op: '×', name: 'times' },
	];

	const operation = operations[Math.floor(Math.random() * operations.length)];
	const num1 = Math.floor(Math.random() * 10) + 1;
	const num2 = operation.op === '-' ? Math.floor(Math.random() * num1) + 1 : Math.floor(Math.random() * 10) + 1;

	let answer: number;
	switch (operation.op) {
		case '+':
			answer = num1 + num2;
			break;
		case '-':
			answer = num1 - num2;
			break;
		case '×':
			answer = num1 * num2;
			break;
		default:
			answer = num1 + num2;
	}

	console.log({
		event: 'challenge_generated',
		operation: operation.name,
		num1,
		num2,
		answer,
	});

	return {
		question: `What is ${num1} ${operation.op} ${num2}?`,
		answer: answer.toString(),
	};
}

async function sendChallengeEmail(
	message: ForwardableEmailMessage,
	challenge: { question: string; answer: string },
	token: string,
	env: Env
): Promise<void> {
	const verificationLink = `https://${WORKER_ROUTE}/verify?token=${token}&answer=`;

	const msg = createMimeMessage();
	msg.setHeader('In-Reply-To', message.headers.get('Message-ID') || '');
	msg.setSender({ name: 'Sentinel System', addr: message.to });
	msg.setRecipient(message.from);
	msg.setSubject('Please verify your email ✉️');

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
    <h1 style="color: #2c3e50; margin-top: 0;">Quick verification needed</h1>
    <p>Hi,</p>
    <p>I've received your email and want to make sure it reaches me safely. To prevent spam, I use a simple one-time verification system for new senders.</p>

    <div style="background-color: white; border-left: 4px solid #3498db; padding: 15px; margin: 20px 0;">
      <p style="font-weight: bold; margin-bottom: 10px;">Your Challenge Question:</p>
      <p style="font-size: 18px; color: #2c3e50;">${challenge.question}</p>
    </div>

    <p>Click the correct answer below:</p>
	<div style="display: flex;">
	${Array.from({ length: 5 }, (_, i) => {
		const answerOption = parseInt(challenge.answer) + i - 2;
		return `<a href="${verificationLink}${answerOption}"
		style="background-color: #3498db; color: white; padding: 10px 15px;
		text-decoration: none; border-radius: 5px; text-align: center;
		margin-right: 10px;">
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
Hi,

I've received your email and want to make sure it reaches me safely. To prevent spam, I use a simple one-time verification system for new senders.

Your challenge question:
${challenge.question}

To verify, click one of these links:
${Array.from(
	{ length: 5 },
	(_, i) => `• ${parseInt(challenge.answer) + i - 2}: ${verificationLink}${parseInt(challenge.answer) + i - 2}`
).join('\n')}

Note:
• This is a one-time verification. Once completed, your future emails will be delivered automatically.
• This verification link expires in 24 hours.

Thank you for your understanding.
`.trim();

	msg.addMessage({
		contentType: 'text/plain',
		data: plainText,
	});

	msg.addMessage({
		contentType: 'text/html',
		data: htmlContent,
	});

	const replyMessage = new EmailMessage(message.to, message.from, msg.asRaw());

	await message.reply(replyMessage);

	console.log({
		event: 'challenge_email_sent',
		sender: message.from,
		token,
		question: challenge.question,
		messageId: message.headers.get('Message-ID'),
	});
}

export default {
	async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
		// Parses SRS if necessary
		const emailBytes = new Uint8Array(await new Response(message.raw).arrayBuffer())
		const parsedEmail = parseMail(emailBytes);
		// Check if sender is whitelisted
		const isWhitelisted = await env.WHITELIST_STORE.get(parsedEmail.from!.email);
		if (isWhitelisted) {
			console.log({
				event: 'whitelisted_email_forwarded',
				sender: message.from,
				messageId: message.headers.get('Message-ID'),
			});
			// TODO: Figure out how to support SRS; likely an Email Workers bug.
			await message.forward(TARGET_EMAIL);
			return;
		}

		// Generate challenge
		const challenge = generateChallenge();
		const token = crypto.randomUUID();

		// Parse SRS addresses if present

		// Store challenge state
		const challengeState: ChallengeState = {
			challengeToken: token,
			answer: challenge.answer,
			rawEmail: Array.from(emailBytes),
			timestamp: Date.now(),
		};

		console.log({
			event: 'challenge_stored',
			sender: message.from,
			token,
			timestamp: challengeState.timestamp,
			messageId: message.headers.get('Message-ID'),
		});

		// Store in KV with 24-hour expiration
		await env.CHALLENGE_STORE.put(`challenge:${token}`, JSON.stringify(challengeState), { expirationTtl: 86400 });

		// Send challenge email
		await sendChallengeEmail(message, challenge, token, env);

		console.log({
			event: 'email_received',
			sender: message.from,
			recipient: message.to,
			subject: message.headers.get('Subject'),
			messageId: message.headers.get('Message-ID'),
		});
	},

	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		if (url.pathname === '/verify') {
			const token = url.searchParams.get('token');
			const answer = url.searchParams.get('answer');

			console.log({
				event: 'verification_attempt',
				token,
				answer,
				ip: request.headers.get('CF-Connecting-IP'),
			});

			if (!token || !answer) {
				console.log({
					event: 'verification_error',
					error: 'invalid_parameters',
					token,
					answer,
				});
				return new Response('Invalid verification link', { status: 400 });
			}

			// Retrieve challenge state
			const challengeStateStr = await env.CHALLENGE_STORE.get(`challenge:${token}`);
			if (!challengeStateStr) {
				console.log({
					event: 'verification_error',
					error: 'challenge_not_found',
					token,
				});
				return new Response('Challenge expired or invalid', { status: 400 });
			}

			const challengeState: ChallengeState = JSON.parse(challengeStateStr);

			// Verify answer
			if (answer === challengeState.answer) {
				// Parse email
				const emailBytes = new Uint8Array(challengeState.rawEmail);
				const parsedEmail = parseMail(emailBytes);

				console.log({
					event: 'verification_success',
					token,
					sender: parsedEmail.from,
					messageId: parsedEmail.headers['Message-ID'],
					timeTaken: Date.now() - challengeState.timestamp,
					email: parsedEmail,
					emailBytes: emailBytes.length,
				});

				if (!parsedEmail.from) {
					console.log({
						event: 'verification_error',
						error: 'no_sender',
						token,
						messageId: parsedEmail.headers['Message-ID'],
					});
					return new Response('No sender found in email', { status: 400 });
				}

				// Add sender to whitelist
				await env.WHITELIST_STORE.put(parsedEmail.from.email, '1');

				// Forward the original email
				const emailToForward = new EmailMessage(
					SENTINEL_EMAIL,
					TARGET_EMAIL,
					craftForwardedEmail(parsedEmail, SENTINEL_EMAIL, TARGET_EMAIL, WORKER_ROUTE).asRaw()
				);

				await env.MAILER.send(emailToForward);

				console.log({
					event: 'email_forwarded',
					sender: parsedEmail.from,
					messageId: parsedEmail.headers['Message-ID'],
					email: emailToForward,
				});

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
              </div>
            </body>
          </html>`,
					{
						status: 200,
						headers: {
							'Content-Type': 'text/html',
						},
					}
				);
			}

			console.log({
				event: 'verification_error',
				error: 'incorrect_answer',
				token,
				expectedAnswer: challengeState.answer,
				providedAnswer: answer,
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
						'Content-Type': 'text/html',
					},
				}
			);
		}

		return new Response('Not found', { status: 404 });
	},
};
