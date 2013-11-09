define([
  'angular',
  'underscore',
  'config'
],
function (angular, _, config) {
  'use strict';

  var module = angular.module('kibana.services');

  module.service('querySrv', function(dashboard, ejsResource) {
    // Create an object to hold our service state on the dashboard
    dashboard.current.services.query = dashboard.current.services.query || {};
    _.defaults(dashboard.current.services.query,{
      idQueue : [],
      list : {},
      ids : [],
    });

    // Defaults for query objects
    var _query = {
      query: '*',
      alias: '',
      pin: false,
      type: 'lucene'
    };

    // For convenience
    var ejs = ejsResource(config.elasticsearch);
    var _q = dashboard.current.services.query;

    this.colors = [
      "#7EB26D","#EAB839","#6ED0E0","#EF843C","#E24D42","#1F78C1","#BA43A9","#705DA0", //1
      "#508642","#CCA300","#447EBC","#C15C17","#890F02","#0A437C","#6D1F62","#584477", //2
      "#B7DBAB","#F4D598","#70DBED","#F9BA8F","#F29191","#82B5D8","#E5A8E2","#AEA2E0", //3
      "#629E51","#E5AC0E","#64B0C8","#E0752D","#BF1B00","#0A50A1","#962D82","#614D93", //4
      "#9AC48A","#F2C96D","#65C5DB","#F9934E","#EA6460","#5195CE","#D683CE","#806EB7", //5
      "#3F6833","#967302","#2F575E","#99440A","#58140C","#052B51","#511749","#3F2B5B", //6
      "#E0F9D7","#FCEACA","#CFFAFF","#F9E2D2","#FCE2DE","#BADFF4","#F9D9F9","#DEDAF7"  //7
    ];

    // Define the query types and the version of elasticsearch they were first available in
    this.queryTypes = [
      {name:'lucene',require:">=0.17.0"},
      {name:'regex',require:">=0.90.3"},
      {name:'derive',require:">=2.0.0"}
    ];


    // Save a reference to this
    var self = this;

    this.init = function() {
      _q = dashboard.current.services.query;
      self.list = dashboard.current.services.query.list;
      self.ids = dashboard.current.services.query.ids;

      // Check each query object, populate its defaults
      _.each(self.list,function(query,id) {
        _.defaults(query,_query);
        query.color = query.color || self.colorAt(id);
      });

      if (self.ids.length === 0) {
        self.set({});
      }
    };

    // This is used both for adding queries and modifying them. If an id is passed, the query at that id is updated
    this.set = function(query,id) {
      if(!_.isUndefined(id)) {
        if(!_.isUndefined(self.list[id])) {
          _.extend(self.list[id],query);
          return id;
        } else {
          return false;
        }
      } else {
        var _id = query.id || nextId();
        query.id = _id;
        query.color = query.color || self.colorAt(_id);
        _.defaults(query,_query);

        self.list[_id] = query;
        self.ids.push(_id);
        return _id;
      }
    };

    this.remove = function(id) {
      if(!_.isUndefined(self.list[id])) {
        delete self.list[id];
        // This must happen on the full path also since _.without returns a copy
        self.ids = dashboard.current.services.query.ids = _.without(self.ids,id);
        _q.idQueue.unshift(id);
        _q.idQueue.sort(function(v,k){
          return v-k;
        });
        return true;
      } else {
        return false;
      }
    };

    this.getEjsObj = function(id) {
      return self.toEjsObj(self.list[id]);
    };

    this.toEjsObj = function (q) {
      switch(q.type)
      {
      case 'lucene':
        return ejs.QueryStringQuery(q.query || '*');
      case 'regex':
        return ejs.RegexpQuery('_all',q.query);
      default:
        return _.isUndefined(q.query) ? false : ejs.QueryStringQuery(q.query || '*');
      }
    };

    this.findQuery = function(queryString) {
      return _.findWhere(self.list,{query:queryString});
    };

    this.idsByMode = function(config) {
      switch(config.mode)
      {
      case 'all':
        return self.ids;
      case 'pinned':
        return _.pluck(_.where(self.list,{pin:true}),'id');
      case 'unpinned':
        return _.difference(self.ids,_.pluck(_.where(self.list,{pin:true}),'id'));
      case 'selected':
        return _.intersection(self.ids,config.ids);
      case 'none':
      case 'index':
        return [];
      default:
        return self.ids;
      }
    };

    this.isMatchAllQuery = function(id) {
      var q = self.list[id];
      return (q.query == "*" || q.query == "");
    }

    //returns { query, filter }
    this.getQueryFilterParts = function (filterSrv, queries, queryString, highlight, stackedQueries) {
      if (_.isUndefined(highlight)) highlight = null;
      if (_.isUndefined(stackedQueries)) stackedQueries = null;

      var facetQuery = ejs.MatchAllQuery();

      var queryIds = self.idsByMode(queries);
      if (queryIds != null && queryIds.length == 1) 
        if (self.isMatchAllQuery(queryIds[0])) 
          queryIds = null;

      var hasQueries = (queryIds != null && queryIds.length > 0) || (_.isArray(stackedQueries) && stackedQueries.length > 0);
      var shouldQueries = [];
      var must = null;

      if (hasQueries) {
        if (_.isArray(highlight) && highlight.length > 0) 
          highlight = ["_all"].concat(highlight);
        else
          highlight = null;

        if (queryIds != null && queryIds.length > 0) {
          _.each(queryIds, function (id) {
            var q = self.getEjsObj(id);
            if (_.isObject(q) && highlight != null) q = q.fields(highlight);
            if (must == null) must = ejs.BoolQuery();
            must = must.should(q);
          });
        }

        if (_.isArray(stackedQueries)) {
          _.each(stackedQueries, function (query) {
            if (_.isString(query)) {
              var q = ejs.QueryStringQuery(query);
              if (highlight != null) q = q.fields(highlight);
              shouldQueries.push(q);
            }
            else if (_.isObject(query)) {
              var type = !_.isUndefined(query.type) ? query.type : null;
              switch (type) {
                case "terms": 
                  {
                    var q = ejs.TermsQuery(query.field, query.terms);
                    shouldQueries.push(q);
                  }
                  break;
              }
            }
          });
        }
      }

      var facetFilter = ejs.BoolFilter();
      if (queries.mode != "index") facetFilter = filterSrv.getBoolFilter(filterSrv.ids);
      self.appendQueryStringFilter(facetFilter, queryString);

      //optimization: move query into filter
      if (highlight == null) {
        if (must != null) facetFilter = facetFilter.must(ejs.QueryFilter(must).cache(true));
        _.each(shouldQueries, function (q) {
          facetFilter = facetFilter.should(ejs.QueryFilter(q).cache(true));
        });
        facetQuery = ejs.MatchAllQuery();
      }
      else {
        if (must != null || shouldQueries.length > 0) {
          facetQuery = ejs.BoolQuery();
          if (must != null) facetQuery = facetQuery.must(must);
          _.each(shouldQueries, function (q) {
            facetQuery = facetQuery.should(q);
          });
        }
      }

      //ensure we don't have an empty must clause
      if (facetFilter.must().length <= 0)
        facetFilter = facetFilter.must(ejs.MatchAllFilter());

      var result = { query: facetQuery, filter: facetFilter };

      return result;
    };

    this.appendAQueryStringFilter = function (facetFilter, query) {
      if (_.isString(query)) {
        var qs = ejs.QueryStringQuery(query);
        facetFilter = facetFilter.must(ejs.QueryFilter(qs).cache(true));
      }
      else if (_.isObject(query)) {
        var type = !_.isUndefined(query.type) ? query.type : null;
        switch (type) {
          case "term": 
            {
              var q = ejs.TermFilter(query.field, query.terms);
              facetFilter = facetFilter.must(q);
            }
            break;
        }
      }
    }

    this.appendQueryStringFilter = function (facetFilter, queryString) {
      if (!_.isUndefined(queryString) && queryString != null && queryString != "") {
        if (_.isArray(queryString)) {
          _.each(queryString, function (q) {
            if (!_.isUndefined(q) && q != null && q != "") {
              self.appendAQueryStringFilter(facetFilter, q);
            }
          });
        }
        else if (_.isString(queryString) || _.isObject(queryString)) {
          self.appendAQueryStringFilter(facetFilter, queryString);
        }
      }
    }

    this.getFacetFilter = function (filterSrv, queries, queryString) {
      var filterParts = self.getQueryFilterParts(filterSrv, queries, queryString);
      var result = ejs.QueryFilter(ejs.FilteredQuery(filterParts.query, filterParts.filter));
      return result;
    };

    this.getFacetQuery = function (filterSrv, queries, queryString, highlight, stackedQueries) {
      var filterParts = self.getQueryFilterParts(filterSrv, queries, queryString, highlight, stackedQueries);
      var result = ejs.FilteredQuery(filterParts.query, filterParts.filter);
      return result;
    };

    this.getFacetFilterByQueryId = function (filterSrv, id, queryString) {
      var facetFilter = filterSrv.getBoolFilter(filterSrv.ids);

      self.appendQueryStringFilter(facetFilter, queryString);

      facetFilter = ejs.QueryFilter(
        ejs.FilteredQuery(
          self.getEjsObj(id),
          facetFilter
        ));

      return facetFilter;
    };

    var nextId = function() {
      if(_q.idQueue.length > 0) {
        return _q.idQueue.shift();
      } else {
        return self.ids.length;
      }
    };

    this.colorAt = function(id) {
      return self.colors[id % self.colors.length];
    };

    self.init();
  });

});