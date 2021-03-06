var mailgun = require('mailgun'),
    formidable = require('formidable'),
    email = require('../email'),
    templating = require('../templating'),
    db = require('../db'),
    emailUtil = require('../util/email'),
    nots = require('../notifications'),
    models = require('../models');

var serve = function(req, _finish) {
  var match = req.url.match(/\w+\/\d+$/);
  var id = match && match[0];

  // If we couldn't grab what looks like a listing id from the URL, we
  // should bail.
  if (!id) return _finish(404, 'Not Found');

  var form = new formidable.IncomingForm();
  form.parse(req, function(err, fields, files) {

    // Handle errors with basic fail
    if (err) return _finish(500, 'Server Error');

    // Verify the request
    if (!email.verify(fields.timestamp, fields.token, fields.signature))
      return _finish(400, 'Bad Request');

    // Record the email in the database
    var m = new models.IncomingEmail();
    for (var i in fields) if (fields.hasOwnProperty(i))
      m[i] = fields[i];
    db.apply(m);

    // Check to see if this is from Craigslist or Kijiji
    var fromCraig = !! fields.sender.match(/noreply@craigslist.org/);
    var fromKijiji = !! fields.sender.match(/@kijiji.ca/)
                     || !! fields.from.match(/Kijiji Canada/)
                     || !! fields.from.match(/@kijiji.ca/);

    // If it looks like a kijiji or craigslist activation email, send
    // it to crosspost@hipsell.com and finish.
    if (fromCraig
    || (fromKijiji && fields.subject.match(/^Activate your Kijiji Ad/))) {
      email.send(null,
                 'crosspost@hipsell.com',
                 'Activation Email For: ' + fields.subject,
                 '<h4>Original Sender: ' + fields.from +
                 '</h4><p>' + (fields['body-html'] || fields['body-plain']) + '</p>');

      // Bail out.
      return _finish(200, 'OK');
    // Handle ad removed messages by forwarding them to the crossposter.
    } else if (fromKijiji && fields.subject.match(/^Your Kijiji Ad was removed/)) {
      email.send(null,
                 'crosspost@hipsell.com',
                 'Kijiji Ad Removed!',
                 '<p>' + (fields['body-html'] || fields['body-plain']) + '</p>');
      return _finish(200, 'OK');
    }

    // Fetch the relevant listing
    var listing = new models.Listing();
    listing._id = id;
    db.get(listing, function(err, found) {

      // If there's no such listing, bail out
      if (err || !found) return _finish(404, 'Not Found');

      // Report success to mailgun, and handle the rest from here.
      _finish(200, 'OK');

      // If the listing is already sold, we skip a lot of the work
      // and just send a "No longer available" email.
      if (listing.sold) {
        email.send('Auto Response - Sold',
                   fields.from,
                   'Re: ' + fields.subject,
                   templating['email/autoresponse_sold'].render({userid: listing.creator}),
                   'Hipsell <' + listing.email + '>',
                   fields['Message-Id'] || undefined);

        return;
      }

      // Kijiji email replies are a little odd, so we have to handle
      // them as special cases.
      var isKijijiReply = fromKijiji && !!fields.from.match(/^"Kijiji Reply/);

      // Try to fetch the auth object for this user
      var auth = new models.Auth();
      if (isKijijiReply)
        auth._id = fields.from.match(/ (\S*)\)"/)[1];
      else
        auth._id = fields.from.match(/[^\s<"]+@[^\s>"]+/)[0];

      db.get(auth, function(err, exists) {

        // Treat error the same as a not exists case
        exists = !err && exists;

        // Try to fetch an existing conversation
        var q = {
          listing: listing._id
        };
        if (exists) {
          q.creator = auth.creator
        } else {
          q.creator = null;
          q.email = auth._id;
        }
        db.queryOne(models.Convo, q, function(err, convo) {

          // We'll need this later
          var convoWasCreated = !convo;

          // If there's an error... well, recovering from that is
          // going to be a bitch, so...
          if (err) return; //TODO - Recover

          // Common code; DRY
          var finish = function() {
            // So at this point, we have access to a few things:
            //  * The sender's email
            //  * The relevant convo object
            //  * Whether or not we created the convo

            // If we created the convo, we'll open up with a straight
            // autoreply email to the sender -- this works nicely, as
            // we won't really have anything to send them anyway until
            // the listing creator responds.
            if (convoWasCreated)
              email.send('Auto Response',
                         fields.from,
                         'Re: ' + fields.subject,
                         templating['email/autoresponse'].render({listing: listing}),
                         'Hipsell <' + listing.email + '>',
                         fields['Message-Id'] || undefined);

            // Update the `lastEmail` field on the convo.  This will
            // point to the email's Message-ID, and will be used when
            // sending responses to ensure that threading happens
            // properly (using the In-Reply-To header).
            convo.lastEmail = fields['Message-Id'] || null;
            // Strip out any wrapping brackets
            if (convo.lastEmail)
              convo.lastEmail = convo.lastEmail.replace(/^</, '')
                                               .replace(/>$/, '');
            // Save to db
            db.apply(convo);

            // Now all we have to do is create the message and we're golden.
            var message = new models.Message();
            message.creator = auth.creator || null;
            if (!message.creator) message.email = auth._id;
            message.convo = convo._id;
            message.offer = null;
            if (isKijijiReply) {
              message.message = emailUtil.stripKijijiReply(fields['body-plain']);
            } else {
              message.message = emailUtil.preprocess(fields['body-plain'], true);
              message.message = emailUtil.chopPlain(message.message);
            }
            db.apply(message);
            // TODO - check out Mailgun's sig/quote stripping
            //        functionality

            // Send a notification to the listing owner.
            nots.send(listing.creator, nots.Types.NewMessage, message, listing);

            // Fin.
          };

          // If the convo doesn't exist we need to create it
          if (!convo) {
            // Note how we handle the nonexistant user case: creator
            // is null, and the email field is set to that email
            // address.
            convo = new models.Convo();
            convo.creator = auth.creator || null;
            convo.listing = listing._id;
            if (!exists) {
              convo.email = auth._id;
              convo.subject = fields.subject;
            }
            // Mark it as coming from Kijiji if it's a Kijiji reply
            if (isKijijiReply)
              convo.iskj = true;
            db.apply(convo, finish);
          } else {
            finish();
          }
        });
      });
    });
  });
};

exports.serve = serve;
