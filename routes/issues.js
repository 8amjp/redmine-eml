var express = require('express');
var router = express.Router();
var path = require('path');
var fs = require('fs');
var request = require('request-promise-native');
var nodemailer = require('nodemailer');
var MailComposer = require('nodemailer/lib/mail-composer');
var template = require('es6-template-strings');

var config = require('../config/config');

var headers = {
  'Content-Type': 'application/json',
  'X-Redmine-API-Key': config.api_key
};
var format = '.json';

var message = {
  'from': config.message.from,
  'bcc': config.message.bcc || []
};

// /issues/:id*
router.get('/:id(\\d+)*', function (req, res, next) {
  let id = req.params.id;
  request({ url: `${config.api_base_url}issues/${id}${format}?include=watchers`, headers: headers, json: true })
  .then(function (data) {
    let issue = data.issue;
    Promise.all([
      requestTo(issue.assigned_to.id),
      requestCc(issue.watchers),
      parseSubject(issue),
      parseBody(issue)
    ])
    .then(function(){
      next();
    })
  })
});

// /issues/:id
router.get('/:id(\\d+)', function (req, res) {
  let id = req.params.id;
  res.render('issue', {
    'message': message,
    'host_name': config.host_name || 'http://localhost/redmine/',
    'id': id,
    'download_url': path.join(req.originalUrl, 'download')
  })
});

// /issues/:id/download
router.get('/:id(\\d+)/download', function (req, res) {
  let id = req.params.id;
  var mail = new MailComposer(message);
  mail.compile().build(function(err, msg){
    res.setHeader('Content-Disposition', `attachment; filename=${id}.eml`);
    res.setHeader('Content-Transfer-Encoding', 'binary');
    res.setHeader('Content-type', 'message/rfc822');
    res.send(msg);
  });
});

// Toを取得
function requestTo(id) {
  return new Promise(function(resolve, reject) {
    // グループ取得
    request({ url: `${config.api_base_url}groups/${id}${format}?include=users`, headers: headers, json: true })
    .then(function(data){
      message.to = config.message.to || [];
      let iterable = [];
      data.group.users.forEach(function(user) {
        iterable.push(
          requestUser(user.id)
          .then(function(address){
            message.to.push(address);
          })
        );
      });
      Promise.all(iterable)
      .then(function(){
        resolve();
      })
      .catch(function(){
        reject();
      })
    })
    // ユーザー取得
    .catch(function(){
      requestUser(id)
      .then(function(address){
        message.to.push(address);
        resolve();
      })
    })
  })
}

// CCを取得
function requestCc(watchers) {
  return new Promise(function(resolve, reject) {
    message.cc = config.message.cc || [];
    let iterable = [];
    watchers.forEach(function(user) {
      iterable.push(
        requestUser(user.id)
        .then(function(address){
          message.cc.push(address);
        })
      )
    })
    Promise.all(iterable)
    .then(function(){
      resolve();
    })
    .catch(function(){
      reject();
    })
  })
}

// 件名の編集
function parseSubject(issue) {
  return new Promise(function(resolve, reject) {
    message.subject = template(config.message.subject, { issue: issue, host_name: config.host_name });
    resolve();
  })
}

// 本文の編集
function parseBody(issue) {
  return new Promise(function(resolve, reject) {
    let iterable = [];
    let id;
    let attributes = config.template.use_attributes || [];
    // 本文のヘッダー
    if (config.template.hasOwnProperty('header')) {
      let header = config.template.header;
      attributes.forEach(function(attr) {
        if (issue.hasOwnProperty(attr)) {
          id = issue[attr].id;
          if (header.hasOwnProperty(attr) && header[attr].hasOwnProperty(id)) iterable.push(getTemplate(header[attr][id]));
        }
      });
    }
    // 本文
    if (config.template.hasOwnProperty('body')) {
      iterable.push(getTemplate(config.template.body));
    }
    // 本文のフッター
    if (config.template.hasOwnProperty('footer')) {
      let footer = config.template.footer;
      attributes.forEach(function(attr) {
        if (issue.hasOwnProperty(attr)) {
          id = issue[attr].id;
          if (footer.hasOwnProperty(attr) && footer[attr].hasOwnProperty(id)) iterable.push(getTemplate(footer[attr][id]));
        }
      });
    }
    Promise.all(iterable)
    .then(function(data){
      message.html = template(data.join(''), { issue: issue, host_name: config.host_name });
      resolve();
    })
  })
}
// 本文の編集
function getTemplate(template_path) {
  return new Promise(function(resolve, reject) {
    fs.readFile(path.join('config', template_path), 'utf8', (err, data) => {
      if (!err) {
        console.log(`// ${template_path}: Found.`); //// console.log
        resolve(data);
      } else {
        console.log(`// ${template_path}: Not Found.`); //// console.log
        reject(err);
      }
    })
  })
}

// ユーザー情報を取得
function requestUser(id) {
  return new Promise(function(resolve, reject) {
    request({ url: `${config.api_base_url}users/${id}${format}`, headers: headers, json: true })
    .then(function(data){
      let user = data.user;
      resolve({
        name: `${user.lastname} ${user.firstname}`,
        address: user.mail
      });
    })
  });
}

module.exports = router;