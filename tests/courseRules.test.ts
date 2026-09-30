import { describe, expect, it } from 'vitest';
import { courseRules, looksSecret, mask, reportText } from '../src/lib/courseRules';
import { encodeText } from '../src/lib/text';

// A page wired the way Lectora 19 publishes one (ids and wording invented).
const page = (next: string) => `<html><head><script>
VarLock = new Variable( 'VarLock', '0', 0, 0, 'scorm', 365, 'x', false )
VarSkips = new Variable( 'VarSkips', '0', 0, 0, 'scorm', 365, 'x', false )
VarMode = new Variable( 'VarMode', '1', 0, 0, 'scorm', 365, 'x', false )
VarDoor = new Variable( 'VarDoor', '', 0, 0, 'scorm', 365, 'x', false )
function trivNextPage() {
    trivExitPage( '${next}', true )
}
function loadActions(){
    if(window.bPageLoaded){
      action10(  );
      action11(  );
    }
}
function action10(fn){
    if(VarLock.equals('1'))
    {trivExitPage('a001_lockouts_warning.html',true);
    }else{ action10else();}
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function action10else(fn){
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function action11(fn){
    VarLast.set('' +  VarPageName.getValue() + '');
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function action20(fn){
    grp1.actionShow();
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function progress1onDone() {
  action20();
}
function text2actionShow() {
  setTimeout("if(!text2.isVisible()) { text2.onShow();action21(); }", 1 )
}
function action21(fn){
    progress2.actionPlay();
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function action22(fn){
    trivExitPage('a001_lockouts_time_out.html',true);
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function progress2onDone() {
  action22();
}
function action30(fn){
    if(!VarSkips.greaterThan('3'))
    {trivExitPage('${next}',true);
    }else{ action30else();}
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function action30else(fn){
    trivExitPage('a001_lockouts_warning.html',true);
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function action31(fn){
    VarSkips.add('1');
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function button5onUp() {
  action31();action30();
}
function action40(fn){
    if(VarMode.equals('1'))
    {trivExitPage('${next}',true);
    }else{ action40else();}
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function action40else(fn){
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function audio7onDone(obj) {
	if(is.iOS){action40();}
}
function action50(fn){
    if(VarDoor.equals('open5esame!'))
    {trivExitPage('a001_admin.html',true);
    }else{ action50else();}
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function action50else(fn){
    if(fn && typeof(fn) == 'string' ) eval(fn);
}
function entry9onSelChg() {
  action50();
}
</script></head><body><script>
button5 = new ObjButton('button5', 'Next',954,629,30,30,1,1,'div','',1,0)
text2 = new ObjText('text2',null,10,10,300,40,1,2,null,'div',null,0 )
text2.addInnerText('<div id=\\"text2\\"><p>Your session is about to expire.</p></div>')
grp1 = new ObjInline('grp1',null,0,0,400,100,1,0)
grp1.addChild('text2')
grp1.addChild('progress2')
progress1 = new ObjProgress('progress1','',0,0,200,20,1,18,0,42,'#0000ff','images/p1_bar.png','#eeeeee','images/p1.png',1000,600000,0,0,1,0,0,'div',0 )
progress2 = new ObjProgress('progress2','',0,0,200,20,1,18,0,43,'#0000ff','images/p2_bar.png','#eeeeee','images/p2.png',1000,120000,0,1,0,0,0,'div',0 )
progress3 = new ObjProgress('progress3','',0,0,300,20,0,22,1,29,'#0000ff','images/p3_bar.png','#405d87','images/p3.png',1,379,0,0,0,1,0 )
audio7 = new ObjMedia('audio7','slide1',58,628,300,25,1,107,'media/slide1.mp3',0,1,0,0,1,0.8,1,'div',0, 0 )
entry9 = new ObjInline('entry9',null,0,0,10,10,1,0)
entry9.addInnerText('<form name="entry9form"><input name="door"></form>')
</script></body></html>`;

const files = {
  'a001_one.html': encodeText(page('a001_two.html')),
  'a001_two.html': encodeText(page('a001_three.html')),
  'a001_three.html': encodeText(page('a001_four.html')),
};

describe('course rules', () => {
  it('follows timers from start to what they do', async () => {
    const r = await courseRules(files, null);
    const timers = r.rules.filter((x) => x.category === 'timer').map((x) => [x.title, x.details, x.pages.length]);
    expect(timers).toContainEqual(['10-minute timer (starts when the page opens) — when it runs out', ['show the group with "Your session is about to expire."'], 3]);
    // The second timer is started by the warning appearing, and ends the session.
    expect(timers).toContainEqual(['2-minute timer (starts when the text "Your session is about to expire." appears) — when it runs out', ['go to a001_lockouts_time_out.html'], 3]);
    expect(timers).toHaveLength(2);
    // A progress display (type 0) isn't a timer.
    expect(r.rules.some((x) => x.title.includes('379'))).toBe(false);
  });

  it('reads button conditions, including the otherwise branch', async () => {
    const r = await courseRules(files, null);
    const next = r.rules.find((x) => x.title === 'Clicking the "Next" button')!;
    expect(next.details).toEqual(['add 1 to VarSkips', 'if VarSkips ≤ 3: go to the next page', 'if VarSkips > 3: go to a001_lockouts_warning.html']);
    expect(next.pages).toHaveLength(3); // "the next page" merges the pages
  });

  it('reads narration endings, page-open checks and saved variables', async () => {
    const r = await courseRules(files, null);
    expect(r.rules.find((x) => x.category === 'narration')?.details).toEqual(['if VarMode = 1: go to the next page']);
    expect(r.rules.find((x) => x.category === 'open')?.details).toEqual(['if VarLock = 1: go to a001_lockouts_warning.html', 'set VarLast to VarPageName']);
    expect(r.rules.filter((x) => x.category === 'variable').map((x) => x.title)).toEqual(['VarLock', 'VarSkips', 'VarMode', 'VarDoor']);
  });

  it('finds passwords in the code and never prints them', async () => {
    const r = await courseRules(files, null);
    const pw = r.rules.find((x) => x.category === 'password')!;
    expect(pw.title).toContain(mask('open5esame!'));
    expect(pw.details).toEqual(['entering it can go to a001_admin.html']);
    expect(reportText(r, 'x')).not.toContain('open5esame!');
    expect(looksSecret('open5esame!')).toBe(true);
    expect(looksSecret('1')).toBe(false);
    expect(looksSecret('completed')).toBe(false);
  });
});
