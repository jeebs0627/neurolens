(function(root){
  'use strict';
  root.NLConditionAuth={require:async()=>{
    try{
      const result=await root.NLAuth?.client?.auth.getUser();
      if(!result?.error&&result?.data?.user)return true;
    }catch(_){
      const notice=document.getElementById('conditionAuthNotice');
      if(notice)notice.textContent='로그인 상태를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
      return false;
    }
    const next='/condition'+location.search;
    location.assign('/?next='+encodeURIComponent(next)+'#login');
    return false;
  }};
})(window);
